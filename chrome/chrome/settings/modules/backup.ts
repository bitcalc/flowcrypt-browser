/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

tool.catch.try(async () => {

  let url_params = tool.env.url_params(['account_email', 'action', 'parent_tab_id']);
  let account_email = tool.env.url_param_require.string(url_params, 'account_email');
  let parent_tab_id: string|null = null;
  if(url_params.action !== 'setup') {
    parent_tab_id = tool.env.url_param_require.string(url_params, 'parent_tab_id');
  }
  
  let email_provider: EmailProvider;
  
  tool.ui.passphrase_toggle(['password', 'password2']);
  
  let storage = await Store.get_account(account_email, ['setup_simple', 'email_provider']);
  email_provider = storage.email_provider || 'gmail';
  
  let rules = new Rules(account_email);
  if(!rules.can_backup_keys()) {
    $('body').html(`<div class="line" style="margin-top: 100px;">${Lang.setup.key_backups_not_allowed}</div>`);
    return;
  }

  if(url_params.action === 'setup') {
    $('.back').css('display', 'none');
    if(storage.setup_simple) {
      display_block('step_1_password');
      $('h1').text('Choose a pass phrase');
    } else {
      display_block('step_3_manual');
      $('h1').text('Back up your private key');
    }
  } else if(url_params.action === 'passphrase_change_gmail_backup') {
    if(storage.setup_simple) {
      display_block('loading');
      let [primary_ki] = await Store.keys_get(account_email, ['primary']);
      Settings.abort_and_render_error_if_keyinfo_empty(primary_ki);
      try {
        await do_backup_on_email_provider(account_email, primary_ki.private);
        $('#content').html('Pass phrase changed. You will find a new backup in your inbox.');
      } catch(e) {
        $('#content').html('Connection failed, please <a href="#" class="reload">try again</a>.');
        $('.reload').click(() => window.location.reload());
      }
    } else { // should never happen on this action. Just in case.
      display_block('step_3_manual');
      $('h1').text('Back up your private key');
    }
  } else if(url_params.action === 'options') {
    display_block('step_3_manual');
    $('h1').text('Back up your private key');
  } else {
    await show_status();
  }
  
  function display_block(name: string) {
    let blocks = ['loading', 'step_0_status', 'step_1_password', 'step_2_confirm', 'step_3_manual'];
    for(let block of blocks) {
      $('#' + block).css('display', 'none');
    }
    $('#' + name).css('display', 'block');
  }
  
  $('#password').on('keyup', tool.ui.event.prevent(tool.ui.event.spree(), function () {
    Settings.render_password_strength('#step_1_password', '#password', '.action_password');
  }));
  
  async function show_status() {
    $('.hide_if_backup_done').css('display', 'none');
    $('h1').text('Key Backups');
    display_block('loading');
    let storage = await Store.get_account(account_email, ['setup_simple', 'key_backup_method', 'google_token_scopes', 'email_provider', 'microsoft_auth']);
    if(email_provider === 'gmail' && tool.api.gmail.has_scope(storage.google_token_scopes || [], 'read')) {
      let keys;
      try {
        keys = await tool.api.gmail.fetch_key_backups(account_email);
      } catch(e) {
        if(tool.api.error.is_network_error(e)) {
          $('#content').html('Could not check for backups: no internet. <a href="#">Try Again</a>').find('a').click(() =>  window.location.reload());
        } else {
          tool.catch.handle_exception(e);
          $('#content').html('Could not check for backups: unknown error. <a href="#">Try Again</a>').find('a').click(() =>  window.location.reload());
        }
        return;
      }
      display_block('step_0_status');
      if(keys && keys.length) {
        $('.status_summary').text('Backups found: ' + keys.length + '. Your account is backed up correctly in your email inbox.');
        $('#step_0_status .container').html('<div class="button long green action_go_manual">SEE MORE BACKUP OPTIONS</div>');
        $('.action_go_manual').click(function () {
          display_block('step_3_manual');
          $('h1').text('Back up your private key');
        });
      } else if(storage.key_backup_method) {
        if(storage.key_backup_method === 'file') {
          $('.status_summary').text('You have previously backed up your key into a file.');
          $('#step_0_status .container').html('<div class="button long green action_go_manual">SEE OTHER BACKUP OPTIONS</div>');
          $('.action_go_manual').click(function () {
            display_block('step_3_manual');
            $('h1').text('Back up your private key');
          });
        } else if(storage.key_backup_method === 'print') {
          $('.status_summary').text('You have previously backed up your key by printing it.');
          $('#step_0_status .container').html('<div class="button long green action_go_manual">SEE OTHER BACKUP OPTIONS</div>');
          $('.action_go_manual').click(function () {
            display_block('step_3_manual');
            $('h1').text('Back up your private key');
          });
        } else { // inbox or other methods
          $('.status_summary').text('There are no backups on this account. If you lose your device, or it stops working, you will not be able to read your encrypted email.');
          $('#step_0_status .container').html('<div class="button long green action_go_manual">SEE BACKUP OPTIONS</div>');
          $('.action_go_manual').click(function () {
            display_block('step_3_manual');
            $('h1').text('Back up your private key');
          });
        }
      } else {
        if(storage.setup_simple) {
          $('.status_summary').text('No backups found on this account. You can store a backup of your key in email inbox. Your key will be protected by a pass phrase of your choice.');
          $('#step_0_status .container').html('<div class="button long green action_go_backup">BACK UP MY KEY</div><br><br><br><a href="#" class="action_go_manual">See more advanced backup options</a>');
          $('.action_go_backup').click(function () {
            display_block('step_1_password');
            $('h1').text('Set Backup Pass Phrase');
          });
          $('.action_go_manual').click(function () {
            display_block('step_3_manual');
            $('h1').text('Back up your private key');
          });
        } else {
          $('.status_summary').text('No backups found on this account. If you lose your device, or it stops working, you will not be able to read your encrypted email.');
          $('#step_0_status .container').html('<div class="button long green action_go_manual">BACK UP MY KEY</div>');
          $('.action_go_manual').click(function () {
            display_block('step_3_manual');
            $('h1').text('Back up your private key');
          });
        }
      }
    } else { // gmail read permission not granted - cannot check for backups
      display_block('step_0_status');
      $('.status_summary').html('FlowCrypt cannot check your backups.');
      let pemissions_button_if_gmail = email_provider === 'gmail' ? '<div class="button long green action_go_auth_denied">SEE PERMISSIONS</div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;': '';
      $('#step_0_status .container').html(pemissions_button_if_gmail + '<div class="button long gray action_go_manual">SEE BACKUP OPTIONS</div>');
      $('.action_go_manual').click(function () {
        display_block('step_3_manual');
        $('h1').text('Back up your private key');
      });
      $('.action_go_auth_denied').click(function () {
        tool.browser.message.send(null, 'settings', { account_email: account_email, page: '/chrome/settings/modules/auth_denied.htm' });
      });
    }
  }
  
  $('.action_password').click(function () {
    if($(this).hasClass('green')) {
      display_block('step_2_confirm');
    } else {
      alert('Please select a stronger pass phrase. Combinations of 4 to 5 uncommon words are the best.');
    }
  });
  
  $('.action_reset_password').click(function () {
    $('#password').val('');
    $('#password2').val('');
    display_block('step_1_password');
    Settings.render_password_strength('#step_1_password', '#password', '.action_password');
    $('#password').focus();
  });
  
  $('.action_backup').click(tool.ui.event.prevent(tool.ui.event.double(), async (self) => {
    let new_passphrase = $('#password').val() as string; // text input
    if(new_passphrase !== $('#password2').val()) {
      alert('The two pass phrases do not match, please try again.');
      $('#password2').val('');
      $('#password2').focus();
    } else {
      let btn_text = $(self).text();
      $(self).html(tool.ui.spinner('white'));
      let [primary_ki] = await Store.keys_get(account_email, ['primary']);
      Settings.abort_and_render_error_if_keyinfo_empty(primary_ki);
      let prv = openpgp.key.readArmored(primary_ki.private).keys[0];
      Settings.openpgp_key_encrypt(prv, new_passphrase);
      await Store.passphrase_save('local', account_email, primary_ki.longid, new_passphrase);
      await Store.keys_add(account_email, prv.armor());
      try {
        await do_backup_on_email_provider(account_email, prv.armor());
      } catch(e) {
        $(self).text(btn_text);
        alert('Need internet connection to finish. Please click the button again to retry.');
        return;
      }
      await write_backup_done_and_render(false, 'inbox');
    }
  }));
  
  function is_master_private_key_encrypted(ki: KeyInfo) {
    let key = openpgp.key.readArmored(ki.private).keys[0];
    return key.primaryKey.isDecrypted === false && !tool.crypto.key.decrypt(key, '').success;
  }
  
  async function do_backup_on_email_provider(account_email: string, armored_key: string) {
    let email_message = await $.get({url:'/chrome/emails/email_intro.template.htm', dataType: 'html'});
    let email_attachments = [tool.file.attachment('cryptup-backup-' + account_email.replace(/[^A-Za-z0-9]+/g, '') + '.key', 'text/plain', armored_key)];
    let message = tool.api.common.message(account_email, account_email, account_email, tool.enums.recovery_email_subjects[0], { 'text/html': email_message }, email_attachments);
    if(email_provider === 'gmail') {
      return await tool.api.gmail.message_send(account_email, message);
    } else {
      throw Error(`Backup method not implemented for ${email_provider}`);
    }
  }

  async function backup_on_email_provider_and_update_ui(primary_ki: KeyInfo) {
    let pass_phrase = await Store.passphrase_get(account_email, primary_ki.longid);
    if(!pass_phrase || !is_pass_phrase_strong_enough(primary_ki, pass_phrase)) {
      return;
    }
    let btn = $('.action_manual_backup');
    let original_btn_text = btn.text();
    btn.html(tool.ui.spinner('white'));
    try {
      await do_backup_on_email_provider(account_email, primary_ki.private);
    } catch (e) {
      return alert('Need internet connection to finish. Please click the button again to retry.');
    } finally {
      btn.text(original_btn_text);
    }
    await write_backup_done_and_render(false, 'inbox');
  }
  
  async function backup_as_file(primary_ki: KeyInfo) { //todo - add a non-encrypted download option
    $(self).html(tool.ui.spinner('white'));
    if(tool.env.browser().name !== 'firefox') {
      tool.file.save_to_downloads('cryptup-' + (account_email).toLowerCase().replace(/[^a-z0-9]/g, '') + '.key', 'text/plain', primary_ki.private);
      await write_backup_done_and_render(false, 'file');
    } else {
      tool.file.save_to_downloads('cryptup-' + (account_email).toLowerCase().replace(/[^a-z0-9]/g, '') + '.key', 'text/plain', primary_ki.private, $('.backup_action_buttons_container'));
    }
  }
  
  async function backup_by_print(primary_ki: KeyInfo) { //todo - implement + add a non-encrypted print option
    throw new Error('not implemented');
  }
  
  async function backup_refused(ki: KeyInfo) {
    await write_backup_done_and_render(tool.time.get_future_timestamp_in_months(3), 'none');
  }
  
  async function write_backup_done_and_render(prompt: number|false, method: KeyBackupMethod) {
    await Store.set(account_email, { key_backup_prompt: prompt, key_backup_method: method });
    if(url_params.action === 'setup') {
      window.location.href = tool.env.url_create('/chrome/settings/setup.htm', { account_email: url_params.account_email });
    } else {
      await show_status();
    }
  }
  
  $('.action_manual_backup').click(tool.ui.event.prevent(tool.ui.event.double(), async (self) => {
    let selected = $('input[type=radio][name=input_backup_choice]:checked').val();
    let [primary_ki] = await Store.keys_get(account_email, ['primary']);
    Settings.abort_and_render_error_if_keyinfo_empty(primary_ki);
    if(!is_master_private_key_encrypted(primary_ki)) {
      alert('Sorry, cannot back up private key because it\'s not protected with a pass phrase.');
      return;
    }
    if(selected === 'inbox') {
      await backup_on_email_provider_and_update_ui(primary_ki);
    } else if(selected === 'file') {
      await backup_as_file(primary_ki);
    } else if(selected === 'print') {
      await backup_by_print(primary_ki);
    } else {
      await backup_refused(primary_ki);
    }
  }));
  
  function is_pass_phrase_strong_enough(ki: KeyInfo, pass_phrase: string) {
    if(!pass_phrase) {
      let pp = prompt('Please enter your pass phrase:');
      if(!pp) {
        return false;
      }
      let k = tool.crypto.key.read(ki.private);
      if(!k.decrypt(pp)) {
        alert('Pass phrase did not match, please try again.');
        return false;
      }
      pass_phrase = pp;
    }
    if(Settings.evaluate_password_strength(pass_phrase).pass === true) {
      return true;
    }
    alert('Please change your pass phrase first.\n\nIt\'s too weak for this backup method.');
    return false;
  }
  
  $('.action_skip_backup').click(tool.ui.event.prevent(tool.ui.event.double(), async () => {
    if(url_params.action === 'setup') {
      await Store.set(account_email, { key_backup_prompt: false });
      window.location.href = tool.env.url_create('/chrome/settings/setup.htm', { account_email: url_params.account_email });
    } else {
      tool.browser.message.send(parent_tab_id, 'close_page');
    }
  }));
  
  $('#step_3_manual input[name=input_backup_choice]').click(function () {
    if($(this).val() === 'inbox') {
      $('.action_manual_backup').text('back up as email');
      $('.action_manual_backup').removeClass('red').addClass('green');
    } else if($(this).val() === 'file') {
      $('.action_manual_backup').text('back up as a file');
      $('.action_manual_backup').removeClass('red').addClass('green');
    } else if($(this).val() === 'print') {
      $('.action_manual_backup').text('back up on paper');
      $('.action_manual_backup').removeClass('red').addClass('green');
    } else {
      $('.action_manual_backup').text('try my luck');
      $('.action_manual_backup').removeClass('green').addClass('red');
    }
  });
  

})();