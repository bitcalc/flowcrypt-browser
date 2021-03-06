/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

tool.catch.try(async () => {

  let url_params = tool.env.url_params(['account_email', 'parent_tab_id']);
  let account_email = tool.env.url_param_require.string(url_params, 'account_email');
  let parent_tab_id = tool.env.url_param_require.string(url_params, 'parent_tab_id');

  openpgp.config.ignore_mdc_error = true; // will only affect OpenPGP in local frame

  let tab_id = await tool.browser.message.required_tab_id();

  let original_content: string;
  let missing_passprase_longids: string[] = [];

  let factory = new Factory(account_email, tab_id);

  tool.browser.message.listen({
    close_dialog: function () {
      $('.passphrase_dialog').html('');
      Promise.all(missing_passprase_longids.map(longid => Store.passphrase_get(account_email, longid))).then(passphrases => {
        if(passphrases.filter(passphrase => passphrase !== null).length) {
          // todo - copy/pasted - unify
          // further - this approach is outdated and will not properly deal with WRONG passphrases that changed (as opposed to missing)
          // see pgp_block.js for proper common implmenetation
          missing_passprase_longids = [];
          $('.action_decrypt').click();
        }
      });
    },
  }, tab_id);

  $('.action_decrypt').click(tool.ui.event.prevent(tool.ui.event.double(), function (self) {
    let encrypted = $('.input_message').val() as string;
    if(!encrypted) {
      alert('Please paste an encrypted message');
      return;
    }
    original_content = $(self).html();
    $(self).html('Decrypting.. ' + tool.ui.spinner('white'));
    tool.crypto.message.decrypt(account_email, encrypted, null, function (result) {
      if(result.success) {
        alert(`MESSAGE CONTENT BELOW\n---------------------------------------------------------\n${result.content.data}`);
      } else if((result.missing_passphrases || []).length) {
        missing_passprase_longids = result.missing_passphrases as string[];
        $('.passphrase_dialog').html(factory.embedded_passphrase(missing_passprase_longids));
      } else {
        delete result.message;
        console.info(result);
        alert('These was a problem decrypting this file, details are in the console.');
      }
      $(self).html(original_content);
    }, 'utf8');
  }));  

})();