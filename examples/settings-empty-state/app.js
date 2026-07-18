const notificationState = document.querySelector('#notification-state');
const stateTitle = document.querySelector('#state-title');
const stateDescription = document.querySelector('#state-description');
const feedback = document.querySelector('#notification-feedback');
const enableButton = document.querySelector('[data-action="enable-notifications"]');
const laterButton = document.querySelector('[data-action="configure-later"]');

function enableNotifications() {
  notificationState.dataset.notificationState = 'enabled';
  stateTitle.textContent = '通知已启用';
  stateDescription.textContent = '你会在重要事项需要处理时收到提醒。';
  feedback.textContent = '通知偏好已保存。';
  enableButton.textContent = '通知已启用';
  enableButton.disabled = true;
  laterButton.hidden = true;
}

function configureLater() {
  feedback.textContent = '好的，你可以随时回来启用通知。';
}

enableButton.addEventListener('click', enableNotifications);
laterButton.addEventListener('click', configureLater);
