const notifier = require('node-notifier');
const path = require('path');

/**
 * Show a Windows Toast notification
 */
function notify(title, message, iconType = 'info') {
  notifier.notify({
    title: `키즈노트 백업 - ${title}`,
    message: message,
    // icon: path.join(__dirname, '../icons/icon128.png'), // Add icon later if available
    sound: true,
    wait: false
  });
  
  console.log(`[${iconType.toUpperCase()}] ${title}: ${message}`);
}

module.exports = {
  notify
};
