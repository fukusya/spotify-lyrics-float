document.getElementById("openHost").addEventListener("click", async () => {
  const hostUrl = chrome.runtime.getURL("host.html");
  const tabs = await chrome.tabs.query({ url: hostUrl });

  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: hostUrl });
  }
  window.close();
});
