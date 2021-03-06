/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

type AttestResult = {message: string, account_email: string, attest_packet_text: string|null};

class AttestError extends Error implements AttestResult {
  attest_packet_text: null|string;
  account_email: string;
  success: false;
  constructor(message: string, attest_packet_text: string|null, account_email: string) {
    super(message);
    this.attest_packet_text = attest_packet_text;
    this.account_email = account_email;
  }
}

class BgAttests {

  private static CHECK_TIMEOUT = 5 * 1000; // first check in 5 seconds
  private static CHECK_INTERVAL = 5 * 60 * 1000; // subsequent checks every five minutes. Progressive increments would be better
  private static ATTESTERS = {
    CRYPTUP: { email: 'attest@cryptup.org', api: undefined as string|undefined, pubkey: undefined as string|undefined }
  };
  private static currently_watching: Dict<number> = {};
  private static attest_ts_can_read_emails: Dict<boolean> = {};
  private static packet_headers = tool.crypto.armor.headers('attest_packet');
    
  static watch_for_attest_email_if_appropriate = async () => {
    for(let pending of await BgAttests.get_pending_attest_requests()) {
      if(pending.email && pending.attests_requested && pending.attests_requested.length && BgAttests.attest_ts_can_read_emails[pending.email]) {
        BgAttests.watch_for_attest_email(pending.email);
      }
    }
  };

  static attest_requested_handler = (request: {account_email: string}, sender: chrome.runtime.MessageSender|'background', respond: Callback) => {
    respond();
    BgAttests.get_pending_attest_requests().then(() => BgAttests.watch_for_attest_email(request.account_email));
  };
  
  static attest_packet_received_handler = async (request: {account_email: string, packet: string, passphrase: string}, sender: chrome.runtime.MessageSender|'background', respond: Callback) => {
    try { // todo - could be refactored to pass AttestResult directly
      let r = await BgAttests.process_attest_and_log_result(request.account_email, request.packet, request.passphrase);
      respond({success: true, result: r.message});
    } catch (e) {
      respond({success: false, result: e.message})
    }
  };
  
  private static watch_for_attest_email = (account_email: string) => {
    clearInterval(BgAttests.currently_watching[account_email]);
    setTimeout(() => BgAttests.check_email_for_attests_and_respond(account_email), BgAttests.CHECK_TIMEOUT);
    BgAttests.currently_watching[account_email] = window.setInterval(() => BgAttests.check_email_for_attests_and_respond(account_email), BgAttests.CHECK_INTERVAL);
  };
  
  private static stop_watching = (account_email: string) => {
    clearInterval(BgAttests.currently_watching[account_email]);
    delete BgAttests.currently_watching[account_email];
  };
  
  private static check_email_for_attests_and_respond = async (account_email: string) => {
    let storage = await Store.get_account(account_email, ['attests_requested']);
    let [primary_ki] = await Store.keys_get(account_email, ['primary']);
    if(primary_ki) {
      let passphrase = await Store.passphrase_get(account_email, primary_ki.longid);
      if(passphrase !== null) {
        if(storage.attests_requested && storage.attests_requested.length && BgAttests.attest_ts_can_read_emails[account_email]) {
          for(let message of Object.values(await BgAttests.fetch_attest_emails(account_email))) {
            if(message.payload.mimeType === 'text/plain' && message.payload.body && message.payload.body.size > 0 && message.payload.body.data) {
              BgAttests.process_attest_and_log_result(account_email, tool.str.base64url_decode(message.payload.body.data), passphrase);
            }
          }
        } else {
          await BgAttests.add_attest_log(new AttestError('cannot fetch attest emails for ' + account_email, null, account_email));
          BgAttests.stop_watching(account_email);
        }
      } else {
        console.log('cannot get pass phrase for signing - skip fetching attest emails for ' + account_email);
      }
    } else {
      console.log('no primary key set yet - skip fetching attest emails for ' + account_email);
    }  
  };

  private static process_attest_packet_text = async (account_email: string, attest_packet_text: string, passphrase: string|null): Promise<AttestResult> => {
    let attest = tool.api.attester.packet.parse(attest_packet_text);
    let [primary_ki] = await Store.keys_get(account_email, ['primary']);
    if(!primary_ki) {
      BgAttests.stop_watching(account_email);
      return {attest_packet_text, message: 'No primary_ki for ' + account_email, account_email};
    }
    let key = openpgp.key.readArmored(primary_ki.private).keys[0];
    let {attests_processed} = await Store.get_account(account_email, ['attests_processed']);
    if (!tool.value(attest.content.attester).in(attests_processed || [])) {
      let stored_passphrase = await Store.passphrase_get(account_email, primary_ki.longid);
      if (tool.crypto.key.decrypt(key, passphrase || stored_passphrase || '').success) {
        let expected_fingerprint = key.primaryKey.fingerprint.toUpperCase();
        let expected_email_hash = tool.crypto.hash.double_sha1_upper(tool.str.parse_email(account_email).email);
        if (attest && attest.success && attest.text && attest.content.attester in BgAttests.ATTESTERS && attest.content.fingerprint === expected_fingerprint && attest.content.email_hash === expected_email_hash) {
          let signed;
          try {
            signed = await tool.crypto.message.sign(key, attest.text, true) as string; // todo - avoid "as string"
          } catch(e) {
            throw new AttestError('Error signing the attest. Write me at human@flowcrypt.com to find out why:' + e.message, attest_packet_text, account_email);
          }
          try {
            let api_r;
            if(attest.content.action !== 'CONFIRM_REPLACEMENT') {
              api_r = await tool.api.attester.initial_confirm(signed);
            } else {
              api_r = await tool.api.attester.replace_confirm(signed);
            }
            if(!api_r.attested) {
              throw new AttestError('Refused by Attester. Write me at human@flowcrypt.com to find out why.\n\n' + JSON.stringify(api_r), attest_packet_text, account_email);
            }
          } catch(e) {
            throw new AttestError('Error while calling Attester API. Write me at human@flowcrypt.com to find out why.\n\n' + e.message, attest_packet_text, account_email);
          }
          await BgAttests.account_storage_mark_as_attested(account_email, attest.content.attester);
          return {attest_packet_text, message: 'Successfully attested ' + account_email, account_email};
        } else {
          throw new AttestError('This attest message is ignored as it does not match your settings.\n\nWrite me at human@flowcrypt.com to help.', attest_packet_text, account_email);
        }
      } else {
        throw new AttestError('Missing pass phrase to process this attest message.\n\nIt will be processed automatically later.', attest_packet_text, account_email);
      }
    } else {
      BgAttests.stop_watching(account_email);
      return {attest_packet_text, message: 'Already attested ' + account_email, account_email};
    }
  };
  
  private static process_attest_and_log_result = async (account_email: string, attest_packet_text: string, passphrase: string|null) => {
    try {
      return await BgAttests.add_attest_log(await BgAttests.process_attest_packet_text(account_email, attest_packet_text, passphrase));
    } catch (error) {
      return await BgAttests.add_attest_log(error);
    }
  };
  
  private static fetch_attest_emails = async (account_email: string): Promise<Dict<ApirGmailMessage>> => {
    let q = [
      '(from:"' + BgAttests.get_attester_emails().join('" OR from: "') + '")',
      'to:' + account_email, // for now limited to account email only. Alternative addresses won't work.
      'in:anywhere',
      '"' + BgAttests.packet_headers.begin + '"',
      '"' + BgAttests.packet_headers.end + '"',
    ];
    let list_response = await tool.api.gmail.message_list(account_email, q.join(' '), true);
    return tool.api.gmail.messages_get(account_email, (list_response.messages || []).map(m => m.id), 'full');
  };
  
  private static get_pending_attest_requests = async () => {
    let account_emails = await Store.account_emails_get();
    let storages = await Store.get_accounts(account_emails, ['attests_requested', 'google_token_scopes']);
    let pending = [];
    for(let email of Object.keys(storages)) {
      BgAttests.attest_ts_can_read_emails[email] = tool.api.gmail.has_scope(storages[email].google_token_scopes || [], 'read');
      pending.push({email, attests_requested: storages[email].attests_requested || []});
    }
    return pending;
  };
  
  private static get_attester_emails = () => {
    let emails: string[] = [];
    for(let attester of Object.values(BgAttests.ATTESTERS)) {
      emails.push(attester.email);
    }
    return emails;
  };
    
  private static account_storage_mark_as_attested = async (account_email: string, attester: string) => {
    BgAttests.stop_watching(account_email);
    let storage = await Store.get_account(account_email, ['attests_requested', 'attests_processed']);
    if(storage.attests_requested && tool.value(attester).in(storage.attests_requested)) {
      storage.attests_requested.splice(storage.attests_requested.indexOf(attester), 1); //remove attester from requested
      if(typeof storage.attests_processed === 'undefined') {
        storage.attests_processed = [];
      }
      if(!tool.value(attester).in(storage.attests_processed)) {
        storage.attests_processed.push(attester); //add attester as processed if not already there
      }
      await Store.set(account_email, storage);
    }
  };
  
  private static add_attest_log = async (ar: AttestResult) => {
    let success = !(ar instanceof Error);
    console.log('attest result ' + success + ': ' + ar.message);
    let storage = await Store.get_account(ar.account_email, ['attest_log']);
    if(!storage.attest_log) {
      storage.attest_log = [];
    } else if(storage.attest_log.length > 100) { // todo - should do a rolling delete to always keep last X
      storage.attest_log = [{attempt: 100, success: false, result: 'DELETED 100 LOGS'}];
    }
    storage.attest_log.push({attempt: storage.attest_log.length + 1, packet: String(ar.attest_packet_text), success: success, result: ar.message});
    await Store.set(ar.account_email, storage);
    return ar;
  };

}