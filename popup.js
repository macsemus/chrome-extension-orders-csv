const button = document.getElementById("download");
const status = document.getElementById("status");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Собираю заказы…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("Не удалось определить активную вкладку.");
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["collector.js"]
    });
    const payload = result && result[0] && result[0].result;
    if (!payload || !payload.ok) throw new Error(payload?.error || "Не найдена таблица заказов.");
    if (!payload.csv || payload.count < 1) throw new Error("В таблице не найдено заказов. CSV не создан.");

    const url = URL.createObjectURL(new Blob(["\uFEFF", payload.csv], { type: "text/csv;charset=utf-8" }));
    const filename = "orders_" + new Date().toISOString().slice(0, 10) + ".csv";
    await chrome.downloads.download({ url, filename, saveAs: true });
    status.textContent = "Готово: выгружено заказов — " + payload.count + ".";
  } catch (error) {
    status.textContent = error?.message || "Не удалось выгрузить CSV.";
  } finally {
    button.disabled = false;
  }
});