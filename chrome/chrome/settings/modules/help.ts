/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

tool.catch.try(async () => {

  let url_params = tool.env.url_params(['account_email', 'parent_tab_id']);
  let account_email = tool.env.url_param_require.string(url_params, 'account_email');
  let parent_tab_id = tool.env.url_param_require.string(url_params, 'parent_tab_id');

  $('.action_send_feedback').click(async function () {
    let original_button_text = $(this).text();
    let button = this;
    $(this).html(tool.ui.spinner('white'));
    await tool.ui.delay(50); // give spinner time to load
    let msg = $('#input_text').val() + '\n\n\nFlowCrypt ' + tool.env.browser().name +  ' ' +  tool.catch.version();
    try {
      let r = await tool.api.cryptup.help_feedback(account_email, msg);
      if(r.sent) {
        $(button).text('sent!');
        alert('Message sent! You will find your response in ' + url_params.account_email + ', check your email later. Thanks!');
        tool.browser.message.send(parent_tab_id, 'close_page');
      } else {
        $(button).text(original_button_text);
        alert('There was an error sending message. Our direct email is human@flowcrypt.com');
      }
    } catch(e) {
      tool.catch.handle_exception(e);
      $(button).text(original_button_text);
      alert('There was an error sending message. Our direct email is human@flowcrypt.com');
    }
  });

})();