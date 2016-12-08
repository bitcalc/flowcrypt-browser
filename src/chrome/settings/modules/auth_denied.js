'use strict';

var url_params = get_url_params(['parent_tab_id']);

$('.action_auth_proceed').click(function() {
  chrome_message_send(url_params.parent_tab_id, 'open_google_auth_dialog');
});

$('.auth_action_limited').click(function() {
  chrome_message_send(url_params.parent_tab_id, 'open_google_auth_dialog', {
    omit_read_scope: true,
  });
});

$('.close_page').click(function() {
  chrome_message_send(url_params.parent_tab_id, 'close_page');
});