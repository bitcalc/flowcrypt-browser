/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

class Subscription implements SubscriptionInfo {
  active: boolean|null = null;
  method: PaymentMethod|null = null;
  level: ProductLevel|null = null;
  expire: string|null = null;

  constructor(stored_subscription: {active: boolean|null, method: PaymentMethod|null, level: ProductLevel, expire?: string|null}|null) {
    if(stored_subscription) {
      this.active = stored_subscription.active;
      this.method = stored_subscription.method;
      this.level = stored_subscription.level;
      this.expire = stored_subscription.expire || null;
    }
  }

  expired() {
    return this.level && this.expire && !this.active;
  }
}

class StoreDbCorruptedError extends Error {}

class StoreDbDeniedError extends Error {}

class StoreDbFailedError extends Error {}

class Store {
  
  // static [f: string]: Function; // https://github.com/Microsoft/TypeScript/issues/6480
  
  private static global_storage_scope = 'global';
  private static db_query_keys = ['limit', 'substring', 'has_pgp'];

  private static env_is_background_script() {
    return window.location && tool.value('_generated_background_page.html').in(window.location.href);
  }

  static index(account_key_or_list: string|string[], key: string|string[]) {
    if(Array.isArray(account_key_or_list)) {
      let all_results: string[] = [];
      for(let account_key of account_key_or_list) {
        all_results = all_results.concat(Store.index(account_key, key));
      }
      return all_results;
    } else {
      let prefix = 'cryptup_' + account_key_or_list.replace(/[^A-Za-z0-9]+/g, '').toLowerCase() + '_';
      if(Array.isArray(key)) {
        return key.map(k => prefix + k);
      } else {
        return prefix + key;
      }
    }
  }

  private static account_storage_object_keys_to_original(account_or_accounts: string|string[], storage_object: RawStore): BaseStore | Dict<BaseStore> {
    if(typeof account_or_accounts === 'string') {
      let fixed_keys_object: BaseStore = {};
      for(let k of Object.keys(storage_object)) {
        let fixed_key = k.replace(Store.index(account_or_accounts as string, '') as string, ''); // checked it's a string above
        if(fixed_key !== k) {
          fixed_keys_object[fixed_key] = storage_object[k];
        }
      }
      return fixed_keys_object;
    } else {
      let results_by_account: Dict<BaseStore> = {};
      for(let account of account_or_accounts) {
        results_by_account[account] = Store.account_storage_object_keys_to_original(account, storage_object) as BaseStore;
      }
      return results_by_account;
    }
  }

  static session_get(account_email: string, key: string): Promise<string|null> {
    return new Promise((resolve) => {
      if(Store.env_is_background_script()) {
        resolve(window.sessionStorage[Store.index(account_email, key) as string]);
      } else {
        tool.browser.message.send(null, 'session_get', {account_email: account_email, key: key}, resolve);
      }
    });
  }

  private static relay_to_background(channel: string, message:Dict<any>|null=null): Promise<any> {
    return new Promise((resolve) => {
      tool.browser.message.send(null, channel, message, resolve);
    });
  }

  static async session_set(account_email: string, key: string, value: string|undefined): Promise<void> {
    if(Store.env_is_background_script()) {
      if(typeof value !== 'undefined') {
        sessionStorage[Store.index(account_email, key) as string] = String(value);
      } else {
        sessionStorage.removeItem(Store.index(account_email, key) as string);
      }
    } else {
      await Store.relay_to_background('session_set', {account_email: account_email, key: key, value: value});
    }
  }

  static async passphrase_save(storage_type: StorageType, account_email: string, longid: string, passphrase: string|undefined) {
    let storage_k = 'passphrase_' + longid;
    if (storage_type === 'session') {
      await Store.session_set(account_email, storage_k, passphrase);
    } else {
      if(typeof passphrase === 'undefined') {
        await Store.remove(account_email, [storage_k]);
      } else {
        let to_save: Dict<string> = {};
        to_save[storage_k] = passphrase;
        await Store.set(account_email, to_save);
      }
    }
  }

  static async passphrase_get(account_email: string, longid: string, ignore_session:boolean=false): Promise<string|null> {
    let storage_k = 'passphrase_' + longid;
    let storage = await Store.get_account(account_email, [storage_k]);
    if(typeof storage[storage_k] === 'string') {
      return storage[storage_k] as string; // checked above
    } else {
      let from_session = await Store.session_get(account_email, storage_k);
      return from_session && !ignore_session ? from_session : null;
    }
  }

  static async keys_get(account_email: string, longids:string[]|null=null) {
    let stored = await Store.get_account(account_email, ['keys']);
    let keys: KeyInfo[] = stored.keys || [];
    if(!longids) {
      return keys
    }
    return keys.filter(ki => tool.value(ki.longid).in(longids) || (tool.value('primary').in(longids) && ki.primary));
  }

  static keys_object(armored_prv: string, primary=false): KeyInfo {
    let longid = tool.crypto.key.longid(armored_prv)!;
    return { // todo - should we not be checking longid!==null? or is it checked before calling this?
      private: armored_prv,
      public: tool.crypto.key.read(armored_prv).toPublic().armor(),
      primary: primary,
      longid: longid,
      fingerprint: tool.crypto.key.fingerprint(armored_prv)!,
      keywords: (window as FcWindow).mnemonic(longid),
    };
  }

  static async keys_add(account_email: string, new_key_armored: string) { // todo: refactor setup.js -> backup.js flow so that keys are never saved naked, then re-enable naked key check
    let keyinfos = await Store.keys_get(account_email);
    let updated = false;
    let new_key_longid = tool.crypto.key.longid(new_key_armored);
    if (new_key_longid) {
      for(let i in keyinfos) {
        if (new_key_longid === keyinfos[i].longid) { // replacing a key
          keyinfos[i] = Store.keys_object(new_key_armored, keyinfos[i].primary);
          updated = true;
        }
      }
      if (!updated) {
        keyinfos.push(Store.keys_object(new_key_armored, keyinfos.length === 0));
      }
      await Store.set(account_email, {keys: keyinfos});
    }
  }

  static async keys_remove(account_email: string, remove_longid: string): Promise<void> {
    let private_keys = await Store.keys_get(account_email);
    let filtered_private_keys = private_keys.filter(ki => ki.longid !== remove_longid);
    await Store.set(account_email, {keys: filtered_private_keys});
  }

  static _global_storage_index_if_null(account: string[]|string|null): string[]|string {
    return (account === null) ? Store.global_storage_scope : account;
  }

  static set(account_email: string|null, values: BaseStore): Promise<void> {
    let storage_update: Dict<any> = {};
    for(let key of Object.keys(values)) {
      storage_update[Store.index(Store._global_storage_index_if_null(account_email), key) as string] = values[key];
    }
    return new Promise(resolve => chrome.storage.local.set(storage_update, () => resolve()));
  }

  static get_global(keys: string[]): Promise<GlobalStore> {
    return new Promise(resolve => {
      chrome.storage.local.get(Store.index(Store.global_storage_scope, keys) as string[], (storage_object: RawStore) => {
        resolve(Store.account_storage_object_keys_to_original(Store.global_storage_scope, storage_object) as GlobalStore);
      });
    });
  }

  static get_account(account: string, keys: string[]): Promise<AccountStore> {
    return new Promise(resolve => {
      chrome.storage.local.get(Store.index(account, keys) as string[], (storage_object: RawStore) => {
        resolve(Store.account_storage_object_keys_to_original(account, storage_object) as AccountStore);
      });
    });
  }

  static get_accounts(accounts: string[], keys: string[]): Promise<Dict<AccountStore>> {
    return new Promise(resolve => {
      chrome.storage.local.get(Store.index(accounts, keys) as string[], (storage_object: RawStore) => {
        resolve(Store.account_storage_object_keys_to_original(accounts, storage_object) as Dict<AccountStore>);
      });
    });
  }

  static async remove(account_email: string|null, keys: string[]) {
    return new Promise(resolve => chrome.storage.local.remove(Store.index(Store._global_storage_index_if_null(account_email), keys), () => resolve()));
  }

  static async account_emails_get(): Promise<string[]> {
    let storage = await Store.get_global(['account_emails']);
    let account_emails: string[] = [];
    if(typeof storage.account_emails !== 'undefined') {
      for(let account_email of JSON.parse(storage.account_emails)) {
        if(!tool.value(account_email.toLowerCase()).in(account_emails)) {
          account_emails.push(account_email.toLowerCase());
        }
      }
    }
    return account_emails;
  }

  static async account_emails_add(account_email: string): Promise<void> { //todo: concurrency issues with another tab loaded at the same time
    if(!account_email) {
      tool.catch.report('attempting to save empty account_email: ' + account_email);
    }
    let account_emails = await Store.account_emails_get();
    if(!tool.value(account_email).in(account_emails) && account_email) {
      account_emails.push(account_email);
      await Store.set(null, { account_emails: JSON.stringify(account_emails) });
      await Store.relay_to_background('update_uninstall_url');
    }
  }

  static async auth_info(): Promise<StoredAuthInfo> {
    let storage = await Store.get_global(['cryptup_account_email', 'cryptup_account_uuid', 'cryptup_account_verified']);
    return {account_email: storage.cryptup_account_email || null, uuid: storage.cryptup_account_uuid || null, verified: storage.cryptup_account_verified || false};
  }

  static async subscription(): Promise<Subscription> {
    let s = await Store.get_global(['cryptup_account_email', 'cryptup_account_uuid', 'cryptup_account_verified', 'cryptup_account_subscription']);
    if(s.cryptup_account_email && s.cryptup_account_uuid && s.cryptup_account_subscription && s.cryptup_account_subscription.level) {
      return new Subscription(s.cryptup_account_subscription);
    } else {
      return new Subscription(null);
    }
  }

  /* db */

  private static normalize_string(str: string) {
    return str.normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase();
  }

  private static db_error_categorize(exception: Error, error_stack: string): Error {
    exception.stack = error_stack.replace(/^Error/, String(exception));
    if(exception.message === 'Internal error opening backing store for indexedDB.open.') {
      return new StoreDbCorruptedError(exception.message);
    } else if(exception.message === 'A mutation operation was attempted on a database that did not allow mutations.') {
      return new StoreDbDeniedError(exception.message);
    } else if(exception.message === 'The operation failed for reasons unrelated to the database itself and not covered by any other error code.') {
      return new StoreDbFailedError(exception.message);
    } else {
      tool.catch.handle_exception(exception);
      return new StoreDbDeniedError(exception.message);
    }
  }

  static db_open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let open_db: IDBOpenDBRequest;
      open_db = indexedDB.open('cryptup', 2);
      open_db.onupgradeneeded = function (event) {
        let contacts;
        if(event.oldVersion < 1) {
          contacts = open_db.result.createObjectStore('contacts', { keyPath: 'email', });
          contacts.createIndex('search', 'searchable', { multiEntry: true, });
          contacts.createIndex('index_has_pgp', 'has_pgp');
          contacts.createIndex('index_pending_lookup', 'pending_lookup');
        }
        if(event.oldVersion < 2) {
          contacts = open_db.transaction.objectStore('contacts');
          contacts.createIndex('index_longid', 'longid');
        }
      };
      open_db.onsuccess = () => resolve(open_db.result);
      let stack_fill = String((new Error()).stack);
      open_db.onblocked = () => reject(Store.db_error_categorize(open_db.error, stack_fill));
      open_db.onerror = () => reject(Store.db_error_categorize(open_db.error, stack_fill));
    });
  }

  private static db_index(has_pgp: boolean, substring: string) {
    if(!substring) {
      throw new Error('db_index has to include substring');
    }
    return(has_pgp ? 't:' : 'f:') + substring;
  }

  private static db_create_search_index_list(email: string, name: string|null, has_pgp: boolean) {
    email = email.toLowerCase();
    name = name ? name.toLowerCase() : '';
    let parts = [email, name];
    parts = parts.concat(email.split(/[^a-z0-9]/));
    parts = parts.concat(name.split(/[^a-z0-9]/));
    let index: string[] = [];
    for(let part of parts) {
      if(part) {
        let substring = '';
        for(let letter of part.split('')) {
          substring += letter;
          let normalized = Store.normalize_string(substring);
          if(!tool.value(normalized).in(index)) {
            index.push(Store.db_index(has_pgp, normalized));
          }
        }
      }
    }
    return index;
  }

  static db_contact_object(email: string, name: string|null, client: string|null, pubkey: string|null, attested: boolean|null, pending_lookup:boolean|number, last_use: number|null): Contact {
    let fingerprint = pubkey ? tool.crypto.key.fingerprint(pubkey) : null;
    return {
      email: email,
      name: name || null,
      pubkey: pubkey,
      has_pgp: pubkey ? 1 : 0, // number because we use it for sorting
      searchable: Store.db_create_search_index_list(email, name, Boolean(pubkey)),
      client: pubkey ? client : null,
      attested: pubkey ? Boolean(attested) : null,
      fingerprint: fingerprint,
      longid: fingerprint ? tool.crypto.key.longid(fingerprint) : null,
      keywords: fingerprint ? (window as FcWindow).mnemonic(tool.crypto.key.longid(fingerprint)!) : null,
      pending_lookup: pubkey ? 0 : (pending_lookup ? 1 : 0),
      last_use: last_use || null,
      date: null,
    };
  }

  static db_contact_save(db: IDBDatabase|null, contact: Contact|Contact[]): Promise<void> {
    return new Promise(async(resolve, reject) => {
      if(db === null) { // relay op through background process
        tool.browser.message.send(null, 'db', {f: 'db_contact_save', args: [contact]}, () => resolve()); // todo - currently will silently swallow errors
      } else {
        if (Array.isArray(contact)) {
          for(let single_contact of contact) {
            await Store.db_contact_save(db, single_contact);
          }
          resolve();
        } else {
          let tx = db.transaction('contacts', 'readwrite');
          let contactsTable = tx.objectStore('contacts');
          contactsTable.put(contact);
          tx.oncomplete = () => resolve();
          let stack_fill = String((new Error()).stack);
          tx.onabort = () => reject(Store.db_error_categorize(tx.error, stack_fill));
        }
      }  
    });
  }

  static db_contact_update(db: IDBDatabase|null, email: string|string[], update: ContactUpdate): Promise<void> {
    return new Promise(async(resolve, reject) => {
      if(db === null) { // relay op through background process
        tool.browser.message.send(null, 'db', {f: 'db_contact_update', args: [email, update]}, resolve); // todo - currently will silently swallow errors
      } else {
        if(Array.isArray(email)) {
          for(let single_email of email) {
            await Store.db_contact_update(db, single_email, update);
          }
          resolve();
        } else {
          let [contact] = await Store.db_contact_get(db, [email]);
          if(contact === null) { // updating a non-existing contact, insert it first
            await Store.db_contact_save(db, Store.db_contact_object(email, null, null, null, null, false, null));
            [contact] = await Store.db_contact_get(db, [email]);
            if(contact === null) { // todo - temporary. If no such errors show by end of June 2018, remove this.
              reject({message: 'contact not found right after inserting it', internal: 'missing_contact', code: null});
              return;
            }
          }
          for(let k of Object.keys(update)) {
            // @ts-ignore - may be saving any of the provided values - could do this one by one while ensuring proper types
            contact[k] = update[k];
          }
          let tx = db.transaction('contacts', 'readwrite');
          let contactsTable = tx.objectStore('contacts');
          contactsTable.put(Store.db_contact_object(email, contact.name, contact.client, contact.pubkey, contact.attested, contact.pending_lookup, contact.last_use));
          tx.oncomplete = tool.catch.try(resolve);
          let stack_fill = String((new Error()).stack);
          tx.onabort = () => reject(Store.db_error_categorize(tx.error, stack_fill));
        }
      }
    });
  }

  static db_contact_get(db: null|IDBDatabase, email_or_longid: string[]): Promise<(Contact|null)[]> {
    return new Promise(async(resolve, reject) => {
      if(db === null) { // relay op through background process
        tool.browser.message.send(null, 'db', {f: 'db_contact_get', args: [email_or_longid]}, resolve);  // todo - currently will silently swallow errors
      } else {
        if(email_or_longid.length === 1) {
          let tx: IDBRequest;
          if(!(/^[A-F0-9]{16}$/g).test(email_or_longid[0])) { // email
            tx = db.transaction('contacts', 'readonly').objectStore('contacts').get(email_or_longid[0]);
          } else { // longid
            tx = db.transaction('contacts', 'readonly').objectStore('contacts').index('index_longid').get(email_or_longid[0]);
          }
          tx.onsuccess = tool.catch.try(() => resolve([tx.result !== undefined ? tx.result : null]));
          let stack_fill = String((new Error()).stack);
          tx.onerror = () => reject(Store.db_error_categorize(tx.error, stack_fill));
        } else {
          let results: (Contact|null)[] = [];
          for(let single_email_or_longid of email_or_longid) {
            let [contact] = await Store.db_contact_get(db, [single_email_or_longid]);
            results.push(contact);
          }
          resolve(results);
        }
      }  
    });
  }

  static db_contact_search(db: IDBDatabase|null, query: DbContactFilter): Promise<Contact[]> {
    return new Promise(async(resolve, reject) => {
      if(db === null) { // relay op through background process
        tool.browser.message.send(null, 'db', {f: 'db_contact_search', args: [query]}, resolve);
      } else {
        for(let key of Object.keys(query)) {
          if(!tool.value(key).in(Store.db_query_keys)) {
            throw new Error('db_contact_search: unknown key: ' + key);
          }
        }
        let contacts = db.transaction('contacts', 'readonly').objectStore('contacts');
        let search: IDBRequest|undefined = undefined;
        if(typeof query.has_pgp === 'undefined') { // any query.has_pgp value
          query.substring = Store.normalize_string(query.substring || '');
          if(query.substring) {
            let results_with_pgp = await Store.db_contact_search(db, { substring: query.substring, limit: query.limit, has_pgp: true });
            if(query.limit && results_with_pgp.length === query.limit) {
              resolve(results_with_pgp);
            } else {
              let results_without_pgp = await Store.db_contact_search(db, { substring: query.substring, limit: query.limit ? query.limit - results_with_pgp.length : undefined, has_pgp: false });
              resolve(results_with_pgp.concat(results_without_pgp));
            }
          } else {
            search = contacts.openCursor();
          }
        } else { // specific query.has_pgp value
          if(query.substring) {
            search = contacts.index('search').openCursor(IDBKeyRange.only(Store.db_index(query.has_pgp, query.substring)));
          } else {
            search = contacts.index('index_has_pgp').openCursor(IDBKeyRange.only(Number(query.has_pgp)));
          }
        }
        if(typeof search !== 'undefined') {
          let found: Contact[] = [];
          search.onsuccess = tool.catch.try(() => {
            let cursor = search!.result; // checked it above
            if(!cursor || found.length === query.limit) {
              resolve(found);
            } else {
              found.push(cursor.value);
              cursor.continue();
            }
          });
          let stack_fill = String((new Error()).stack);
          search.onerror = () => reject(Store.db_error_categorize(search!.error, stack_fill));
        }
      }
    });
  }

}