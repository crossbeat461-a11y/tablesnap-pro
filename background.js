const isRestrictedUrl = (url = "") =>
  /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url) ||
  url.startsWith("https://chrome.google.com/webstore") ||
  url.startsWith("https://chromewebstore.google.com");

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id || isRestrictedUrl(tab.url || "")) return;
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  }).catch(() => {});
});
