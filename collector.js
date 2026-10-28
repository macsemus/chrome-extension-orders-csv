(async () => {
  const requiredHeaders = [
    "ID заказа", "Дата", "Товар", "Количество", "Сумма, ₽", "Статус"
  ];

  const norm = s => (s || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");

  // Функция автоматического приведения дат к формату ГГГГ-ММ-ДД
  function formatDate(str) {
    const s = (str || "").trim();
    if (!s) return "";

    // Если дата уже ГГГГ-ММ-ДД
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // Формат ДД.ММ.ГГГГ или ДД/ММ/ГГГГ
    let m = s.match(/^(\d{2})\D(\d{2})\D(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    // Формат ГГГГ/ММ/ДД
    m = s.match(/^(\d{4})\D(\d{2})\D(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    return s;
  }

  function findTable() {
    return Array.from(document.querySelectorAll("table")).find(table => {
      const header = table.tHead?.rows?.[table.tHead.rows.length - 1]
          || table.querySelector("tr");
      const names = Array.from(header?.cells || []).map(c => norm(c.innerText));
      return requiredHeaders.every(h => names.includes(norm(h)));
    });
  }

  function readRows() {
    const table = findTable();
    if (!table) return null;

    const header = table.tHead?.rows?.[table.tHead.rows.length - 1]
        || table.querySelector("tr");
    const names = Array.from(header?.cells || []).map(c => norm(c.innerText));
    const indexes = requiredHeaders.map(h => names.indexOf(norm(h)));
    const rows = table.tBodies.length
        ? Array.from(table.tBodies).flatMap(b => Array.from(b.rows))
        : Array.from(table.rows).slice(1);

    return rows.map(row =>
        indexes.map((i, colIdx) => {
          let val = i >= 0 ? (row.cells[i]?.innerText || "").trim() : "";

          // Обработка даты
          if (requiredHeaders[colIdx] === "Дата") {
            val = formatDate(val);
          }

          return val;
        })
    ).filter(row => row.some(Boolean));
  }

  function pageNumber() {
    const label = document.querySelector("#pageLabel")?.innerText || "";
    const match = label.match(/(?:страница|page)\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function disabled(el) {
    return !el || el.disabled ||
        el.getAttribute("aria-disabled") === "true" ||
        el.hasAttribute("disabled") ||
        el.classList.contains("disabled");
  }

  function findButton(kind) {
    const elements = Array.from(document.querySelectorAll(
        "button, [role='button'], a"
    ));

    const text = el => norm([
      el.innerText,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("rel"),
      el.getAttribute("data-testid")
    ].filter(Boolean).join(" "));

    const pattern = kind === "next"
        ? /(next|впер[её]д|следующ|далее|›|»)/i
        : /(previous|prev|back|назад|предыдущ|←|«|‹)/i;

    return elements.find(el => pattern.test(text(el)) && !disabled(el));
  }

  function signature() {
    return JSON.stringify(readRows());
  }

  function waitForChange(before, timeout = 4000) {
    return new Promise(resolve => {
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(signature() !== before);
      };

      const observer = new MutationObserver(() => {
        if (signature() !== before) finish();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });

      const timer = setTimeout(finish, timeout);
    });
  }

  function clickAndWait(button) {
    const before = signature();
    button.click();
    return waitForChange(before);
  }

  function csvCell(value) {
    const s = String(value ?? "");
    return /[;"\r\n]/.test(s)
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
  }

  try {
    if (!findTable()) {
      return { ok: false, error: "Не найдена таблица заказов." };
    }

    // Возврат на первую страницу при необходимости
    let page = pageNumber();
    let guard = 0;

    while (page !== null && page > 1 && guard++ < 100) {
      const prev = findButton("prev");
      if (!prev) {
        return {
          ok: false,
          error: "Не найдена кнопка предыдущей страницы. Не удалось начать с первой страницы."
        };
      }

      const changed = await clickAndWait(prev);
      if (!changed) {
        return {
          ok: false,
          error: "Таблица не обновилась при переходе на предыдущую страницу."
        };
      }

      page = pageNumber();
    }

    if (page !== null && page > 1) {
      return { ok: false, error: "Не удалось перейти на первую страницу." };
    }

    const collected = [];
    const seen = new Set();
    const pageSignatures = new Set();

    for (let i = 0; i < 100; i++) {
      const rows = readRows();

      if (rows === null) {
        return { ok: false, error: "Таблица заказов исчезла со страницы." };
      }

      if (!rows.length) {
        return { ok: false, error: "На странице не найдены заказы." };
      }

      const sig = JSON.stringify(rows);
      if (pageSignatures.has(sig)) break;
      pageSignatures.add(sig);

      for (const row of rows) {
        const id = (row[0] || "").trim();
        const key = id || JSON.stringify(row);

        if (!seen.has(key)) {
          seen.add(key);
          collected.push(row);
        }
      }

      const next = findButton("next");
      if (!next) break;

      const changed = await clickAndWait(next);
      if (!changed) break;
    }

    if (!collected.length) {
      return { ok: false, error: "Заказы не найдены." };
    }

    const csv = [
      requiredHeaders,
      ...collected
    ].map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";

    return { ok: true, count: collected.length, csv };
  } catch (e) {
    return {
      ok: false,
      error: "Ошибка сбора заказов: " + (e?.message || String(e))
    };
  }
})();