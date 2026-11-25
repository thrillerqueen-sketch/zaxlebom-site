/* за Хлебом — /mothers-day/ (День мамы 2026)
   Только логика кампании; тексты и ссылки — в mothers-day.config.js.
   Стиль как в main.js: ES5, без зависимостей, страница читаема и без этого файла.

   Что делает:
     1. собирает карточки коллекции из конфига;
     2. читает UTM, сохраняет источник и промокод на время сессии;
     3. копирует кириллический промокод;
     4. считает цели Яндекс Метрики (если в конфиге указан номер счётчика);
     5. переключает режим по московскому времени.

   Чего не делает специально: не определяет, установлено ли приложение — вместо
   этого кнопка «Заказать в приложении» открывает окно выбора (диплинк или магазины),
   и решение принимает сам пользователь. */
(function () {
  'use strict';

  var CONFIG = window.ZH_MOTHERS_DAY;
  if (!CONFIG) return;

  var doc = document;
  var root = doc.documentElement;
  var storage = {
    get: function (key) {
      try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
    },
    set: function (key, value) {
      try { window.sessionStorage.setItem(key, value); } catch (e) {}
    }
  };

  /* ---------- 0. режим ----------
     Предварительный режим выставил скрипт в <head> (он нужен до первой отрисовки,
     чтобы страница не «прыгала»). Здесь он пересчитывается из mothers-day.config.js:
     даты правятся в одном месте. Смена даты на уже открытой вкладке тоже применяется
     — страница не должна предлагать предзаказ после окончания срока. */
  var MODE_KEY = 'zh-md-mode';

  function modeByDate(now) {
    var start = Date.parse(CONFIG.mode.preorderStart);
    var end = Date.parse(CONFIG.mode.preorderEnd);
    if (isNaN(start) || isNaN(end)) return 'preorder';
    if (now < start) return 'showcase';        /* до старта предзаказа витрины ещё нет, но оффер не обещаем */
    if (now <= end) return 'preorder';
    return 'showcase';
  }

  function setMode(mode) {
    root.setAttribute('data-md-mode', mode === 'preorder' ? 'preorder' : 'showcase');
  }

  var override = /[?&]mode=(preorder|showcase)\b/.exec(window.location.search);
  if (override) {
    setMode(override[1]);
    storage.set(MODE_KEY, override[1]);
  } else {
    var saved = storage.get(MODE_KEY);
    setMode(saved === 'preorder' || saved === 'showcase' ? saved : modeByDate(Date.now()));
  }
  var isShowcase = root.getAttribute('data-md-mode') === 'showcase';

  /* Пока вкладка открыта, проверяем режим раз в минуту: в полночь 25 ноября
     предзаказ закрывается без перезагрузки страницы. */
  var currentMode = root.getAttribute('data-md-mode');
  window.setInterval(function () {
    if (storage.get(MODE_KEY)) return;          /* ручной просмотр не перебиваем */
    var next = modeByDate(Date.now());
    if (next !== currentMode) {
      currentMode = next;
      setMode(next);
      window.location.reload();                 /* перерисовать карточки под новый режим */
    }
  }, 60 * 1000);

  /* ---------- 1. utm ----------
     Первый переход задаёт источник: повторное открытие по «голой» ссылке не должно
     менять промокод на другой. Храним UTM одной строкой, чтобы было видно, какой
     именно переход дал код. */
  var UTM_KEY = 'zh-md-utm';

  function readUtmFromUrl() {
    var query = window.location.search;
    if (!query) return null;
    var params = {};
    var pairs = query.replace(/^\?/, '').split('&');
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i]) continue;
      var eq = pairs[i].indexOf('=');
      var key = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
      if (key.indexOf('utm_') !== 0) continue;
      var value = eq === -1 ? '' : pairs[i].slice(eq + 1);
      try { value = decodeURIComponent(value.replace(/\+/g, ' ')); } catch (e) {}
      params[key.toLowerCase()] = value.trim().toLowerCase();
    }
    return params;
  }

  var storedUtm = null;
  try { storedUtm = JSON.parse(storage.get(UTM_KEY) || 'null'); } catch (e) {}
  var urlUtm = readUtmFromUrl();
  if (urlUtm) {
    storedUtm = urlUtm;
    storage.set(UTM_KEY, JSON.stringify(urlUtm));
  }
  var utm = storedUtm || {};

  /* источник → ключ промокода. Ищем по порядку из конфига: utm_source, затем
     utm_medium и utm_campaign (офлайн-QR и пуши часто приходят без utm_source). */
  function resolvePromoSource() {
    var keys = CONFIG.promo.sourceKeys || ['utm_source'];
    for (var i = 0; i < keys.length; i++) {
      var value = utm[keys[i]];
      if (!value) continue;
      /* utm_medium=paid_social рядом с utm_source=vk_target не должен мешать: сначала
         проверяем точное совпадение с известным каналом */
      if (CONFIG.promo.codes[value]) return value;
      if (value.indexOf('vk') === 0) return 'vk';
      if (value.indexOf('insta') === 0) return 'instagram';
      if (value.indexOf('tg') === 0 || value.indexOf('telegram') === 0) return 'telegram';
      if (value.indexOf('push') === 0) return 'push';
      if (value.indexOf('qr') === 0 || value.indexOf('offline') === 0 || value.indexOf('bakery') === 0) return 'offline';
      if (value.indexOf('maps') === 0 || value.indexOf('2gis') === 0 || value.indexOf('yandex') === 0) return 'maps';
    }
    return null;
  }

  var promoSource = resolvePromoSource();
  var promoCode = promoSource ? CONFIG.promo.codes[promoSource] : null;

  /* Просмотр для сотрудников: ?promo=vk открывает карточку так, будто переход был
     из ВКонтакте. Нужен, чтобы показать код по любому каналу, не собирая UTM.
     Как и ?mode=, ссылка получает noindex и в рекламу не попадает. */
  var promoOverride = /[?&]promo=(vk|instagram|telegram|vk_target|offline|push|maps)\b/.exec(window.location.search);
  if (promoOverride && CONFIG.promo.codes[promoOverride[1]]) {
    promoSource = promoOverride[1];
    promoCode = CONFIG.promo.codes[promoSource];
  }

  /* ---------- 2. аналитика ----------
     Один счётчик на сайт; пока в конфиге null, цели ничего не делают и ошибок нет.
     Кроме Метрики событие уходит в zh:md-goal — так же, как zh:cta на главной:
     если понадобится другой счётчик, подключается одной строкой. */
  function reachGoal(name, params) {
    if (!name) return;
    var payload = { name: name, params: params || {} };
    payload.params.utm_source = utm.utm_source || '';
    payload.params.utm_medium = utm.utm_medium || '';
    payload.params.utm_campaign = utm.utm_campaign || '';
    payload.params.utm_content = utm.utm_content || '';
    try {
      if (CONFIG.metrika && CONFIG.metrika.id && typeof window.ym === 'function') {
        window.ym(CONFIG.metrika.id, 'reachGoal', name, payload.params);
      }
    } catch (e) {}
    try {
      doc.dispatchEvent(new CustomEvent('zh:md-goal', { detail: payload }));
    } catch (e) {}
  }

  var GOALS = (CONFIG.metrika && CONFIG.metrika.goals) || {};

  /* ---------- 3. refs ----------
     var + createElement, а не шаблонные строки: так же, как в main.js, и не нужно
     экранировать данные из конфига. */
  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(id, size) {
    var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    var use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  /* ---------- разделители чисел ----------
     Цены считаются числами, а показываются по-русски: 2160 → «2 160». Неразрывный
     пробел (U+00A0), чтобы «2 160 ₽» не рвалось по строке в узкой карточке. */
  function formatNumber(value) {
    var rounded = Math.round(value);
    return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  }

  /* Цена по промокоду: исходная минус скидка, округлённая до рубля. Пока в конфиге
     нет priceValue или percent, возвращает null — тогда карточка показывает одну
     цену, а не обещает скидку, которую не сможет посчитать. */
  function discountedPrice(product) {
    if (isShowcase) return null;
    var value = product.priceValue;
    var percent = CONFIG.promo && CONFIG.promo.percent;
    if (typeof value !== 'number' || value <= 0 || !percent) return null;
    return Math.round(value * (100 - percent) / 100);
  }

  /* ---------- 4. карточки коллекции ----------
     Разметка повторяет карточку витрины с главной (.menu-card): фото 4:5, подпись
     плашкой внизу. Класс --product добавляет только то, чего у витрины нет: цену
     и кнопку. Состав и вес в карточке не показываем — это всё есть в приложении,
     а меньше текста читается быстрее.
     Если есть цена по промокоду, на плашке появляется метка «по промокоду»:
     иначе покупатель решит, что скидка уже в цене, и удивится в корзине. */
  function buildCard(product) {
    var li = el('li', 'menu-card menu-card--product');
    li.setAttribute('data-product', product.id);

    var img = doc.createElement('img');
    img.src = '/assets/img/' + product.image + '-960.webp';
    img.srcset = '/assets/img/' + product.image + '-640.webp 640w, /assets/img/' + product.image + '-960.webp 960w';
    img.sizes = '(max-width: 760px) 92vw, (max-width: 900px) 46vw, 30vw';
    img.alt = product.alt || product.title;
    img.width = 960;
    img.height = 1200;
    img.loading = 'lazy';
    img.decoding = 'async';
    /* Фото в своём контейнере: при увеличении на hover оно обрезается им,
       а не наезжает на подпись под ним. */
    var media = el('div', 'md-product-media');
    media.appendChild(img);
    li.appendChild(media);

    var body = el('div', 'md-product-body');
    body.appendChild(el('h3', '', product.short || product.title));

    var discounted = discountedPrice(product);
    if (product.price) {
      if (discounted !== null) {
        body.appendChild(el('p', 'menu-card-note', 'по промокоду'));
        var prices = el('p', 'menu-card-prices');
        prices.appendChild(el('s', 'menu-card-price-old', product.price));
        prices.appendChild(el('span', 'menu-card-price', formatNumber(discounted) + '\u00A0₽'));
        body.appendChild(prices);
      } else {
        body.appendChild(el('p', 'menu-card-price', product.price));
      }
    }
    if (product.weight) body.appendChild(el('p', 'menu-card-weight', product.weight));

    /* Кнопка не открывает диплинк сразу: сначала показываем окно выбора (приложение
       установлено / скачать в стор). Диплинк лежит в data-атрибуте, окно его подхватит. */
    var cta = el('button', 'btn btn-solid btn-sm menu-card-cta');
    cta.type = 'button';
    cta.setAttribute('data-deeplink', product.deeplink);
    cta.setAttribute('data-product', product.id);
    cta.appendChild(el('span', '', 'Заказать в приложении'));
    body.appendChild(cta);

    li.appendChild(body);
    return li;
  }

  var productList = doc.querySelector('[data-md-products]');
  if (productList && CONFIG.products && CONFIG.products.length) {
    productList.className = 'menu-grid md-products';
    for (var p = 0; p < CONFIG.products.length; p++) {
      productList.appendChild(buildCard(CONFIG.products[p]));
    }
  }

  /* ---------- 4a. окно выбора после «Заказать в приложении» ----------
     Кнопка карточки открывает <dialog> с тремя путями: диплинк (приложение уже
     стоит) или магазины. Диплинк подставляется на лету — у каждой карточки свой. */
  var appDialog = doc.getElementById('mdAppDialog');
  var dialogDeeplink = doc.querySelector('[data-md-dialog-deeplink]');
  var dialogClose = doc.querySelector('[data-md-dialog-close]');

  function openAppDialog(deeplink, productId) {
    if (!appDialog) return;
    if (dialogDeeplink) {
      dialogDeeplink.href = deeplink || '#';
      dialogDeeplink.setAttribute('data-product', productId || '');
    }
    if (typeof appDialog.showModal === 'function') {
      appDialog.showModal();
    } else {
      appDialog.setAttribute('open', ''); /* старый браузер: без затемнения, но окно видно */
    }
  }

  if (appDialog) {
    if (dialogClose) {
      dialogClose.addEventListener('click', function () { appDialog.close(); });
    }
    /* Клик по фону: у <dialog> фон принадлежит самому элементу, а содержимое обёрнуто
       в .md-dialog-card, поэтому target === appDialog означает клик мимо окна. */
    appDialog.addEventListener('click', function (e) {
      if (e.target === appDialog) appDialog.close();
    });
    /* Диплинк уводит в приложение, страница остаётся — окно закрываем, чтобы по
       возвращении не висел открытый выбор. */
    if (dialogDeeplink) {
      dialogDeeplink.addEventListener('click', function () { appDialog.close(); });
    }
  }

  /* Делегирование: нажатие на кнопку карточки читает data-deeplink и data-product. */
  doc.addEventListener('click', function (e) {
    var cta = e.target.closest ? e.target.closest('.menu-card-cta') : null;
    if (!cta) return;
    openAppDialog(cta.getAttribute('data-deeplink'), cta.getAttribute('data-product'));
  });

  /* product_view: карточка считается просмотренной, если пробыла на экране не меньше
     половины и секунду. Одна карточка — одно событие за сессию, чтобы цель не
     раздувалась при каждом прокручивании. */
  if (productList && 'IntersectionObserver' in window) {
    var seen = storage.get('zh-md-seen');
    var seenIds = {};
    if (seen) {
      var parts = seen.split(',');
      for (var s = 0; s < parts.length; s++) if (parts[s]) seenIds[parts[s]] = true;
    }
    var viewObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isIntersecting) {
          if (entry.target.__mdTimer) { clearTimeout(entry.target.__mdTimer); entry.target.__mdTimer = null; }
          continue;
        }
        var target = entry.target;
        if (target.__mdTimer) continue;
        target.__mdTimer = setTimeout(function (node) {
          var id = node.getAttribute('data-product');
          node.__mdTimer = null;
          if (seenIds[id]) return;
          seenIds[id] = true;
          storage.set('zh-md-seen', Object.keys(seenIds).join(','));
          reachGoal(GOALS.productView, { product: id });
          viewObserver.unobserve(node);
        }, 1000, target);
      }
    }, { threshold: 0.5 });
    var cards = productList.querySelectorAll('[data-product]');
    for (var c = 0; c < cards.length; c++) {
      if (!seenIds[cards[c].getAttribute('data-product')]) viewObserver.observe(cards[c]);
    }
  }

  /* ---------- 5. промокод ----------
     Никакого «случайного» кода: если канал не распознан, показываем универсальный
     текст из конфига, а блок с кодом остаётся скрытым. */
  var promoBox = doc.querySelector('[data-md-promo]');
  var promoText = doc.querySelector('[data-md-promo-text]');
  var promoSide = doc.querySelector('[data-md-promo-side]');
  var promoCodeEl = doc.querySelector('[data-md-promo-code]');
  var promoCopy = doc.querySelector('[data-md-copy]');
  var promoStatus = doc.querySelector('[data-md-copy-status]');
  var percentEl = doc.querySelector('[data-md-percent]');
  var promoPercent = doc.querySelector('[data-md-promo-percent]');
  var promoHint = doc.querySelector('[data-md-promo-hint]');

  if (percentEl && CONFIG.promo.percent) percentEl.textContent = String(CONFIG.promo.percent);

  /* Человеческие названия каналов для текста блока — только для показа, на код не влияют */
  var CHANNEL_NAMES = {
    vk: 'ВКонтакте',
    instagram: 'Instagram',
    telegram: 'Telegram',
    vk_target: 'VK Рекламы',
    offline: 'пекарен',
    push: 'push-уведомления',
    maps: 'Яндекс Карт и 2ГИС'
  };

  if (promoBox) {
    if (promoCode) {
      var channel = CHANNEL_NAMES[promoSource] || '';
      promoBox.setAttribute('data-promo', 'ready');
      if (promoSide) promoSide.hidden = false;
      if (promoCodeEl) promoCodeEl.textContent = promoCode;
      if (promoPercent) {
        promoPercent.textContent = '−' + CONFIG.promo.percent + '%';
        promoPercent.setAttribute('aria-hidden', 'false');
      }
      if (promoText) {
        promoText.textContent = channel
          ? 'Ваш промокод для заказа из ' + channel + '. Вставьте его в корзине приложения — скидка сработает на три позиции коллекции.'
          : 'Ваш промокод для заказа. Вставьте его в корзине приложения — скидка сработает на три позиции коллекции.';
      }
      if (promoHint) promoHint.textContent = 'Скопируйте код, откройте нужный десерт на этой странице и вставьте код в корзине.';
    } else {
      /* Без UTM кода нет — и большой «−10%» без кода был бы обещанием, которое
         не сбудется в корзине. Поэтому крупная цифра уходит, остаётся текст. */
      promoBox.setAttribute('data-promo', 'none');
      if (promoSide) promoSide.hidden = true;
      if (promoPercent) {
        promoPercent.textContent = '';
        promoPercent.setAttribute('aria-hidden', 'true');
      }
      if (promoText) promoText.textContent = CONFIG.promo.fallback;
      if (promoHint) promoHint.textContent = 'Скидка ' + CONFIG.promo.percent + '% действует только на три позиции коллекции.';
    }
  }

  /* Копирование кириллицы. clipboard.writeText — современный путь; старые Safari и
     http-страницы его не знают, для них textarea + execCommand. Текст копируется
     ровно таким, каким показан, без пробелов и кавычек. */
  function legacyCopy(text) {
    var area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    doc.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) {}
    doc.body.removeChild(area);
    return ok;
  }

  function flashStatus(message) {
    if (!promoStatus) return;
    promoStatus.textContent = message;
    if (promoStatus.__mdTimer) clearTimeout(promoStatus.__mdTimer);
    promoStatus.__mdTimer = setTimeout(function () { promoStatus.textContent = ''; }, 4000);
  }

  function selectCode() {
    if (!promoCodeEl) return;
    try {
      var range = doc.createRange();
      range.selectNodeContents(promoCodeEl);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }

  /* Копирование одним путём для двух кнопок: промокод и образец комментария.
     Возвращает true, если текст удалось скопировать современным способом или
     запасным; сообщение об ошибке показывает вызывающий. */
  function copyText(text, onDone) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { onDone(true); }, function () { onDone(legacyCopy(text)); });
    } else {
      onDone(legacyCopy(text));
    }
  }

  if (promoCopy) {
    promoCopy.addEventListener('click', function () {
      if (!promoCode) return;
      reachGoal(GOALS.promoCopy, { promo: promoCode, source: promoSource });

      copyText(promoCode, function (ok) {
        if (ok) {
          flashStatus('Промокод скопирован — вставьте его в приложении при оформлении заказа.');
          if (promoBox) promoBox.setAttribute('data-promo', 'copied');
        } else {
          selectCode();
          flashStatus('Не удалось скопировать автоматически — код выделен, скопируйте его вручную.');
        }
      });
    });
  }

  /* Комментарий к заказу собирается из даты, времени, имени и номера телефона.
     Цель не своя: это тот же шаг, что и копирование промокода, поэтому в Метрике
     считаем его как promo_copy_click с пометкой comment — иначе список целей
     растёт быстрее, чем ими пользуются. */
  var commentEl = doc.querySelector('[data-md-comment-text]');
  var commentCopy = doc.querySelector('[data-md-comment-copy]');
  var commentStatus = doc.querySelector('[data-md-comment-status]');
  var commentDate = doc.querySelector('[data-md-comment-date]');
  var commentTime = doc.querySelector('[data-md-comment-time]');
  var commentName = doc.querySelector('[data-md-comment-name]');
  var commentPhone = doc.querySelector('[data-md-comment-phone]');
  var commentDates = {
    '2026-11-26': '26 ноября',
    '2026-11-27': '27 ноября',
    '2026-11-28': '28 ноября',
    '2026-11-29': '29 ноября'
  };
  var commentDateKeys = ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];

  function moscowDateKey(now) {
    if (window.Intl && Intl.DateTimeFormat.prototype.formatToParts) {
      var formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(now);
      var parts = {};
      for (var i = 0; i < formatted.length; i++) parts[formatted[i].type] = formatted[i].value;
      return parts.year + '-' + parts.month + '-' + parts.day;
    }
    var moscow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    return moscow.getUTCFullYear() + '-' +
      ('0' + (moscow.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + moscow.getUTCDate()).slice(-2);
  }

  function hasFutureCommentTime(date, nowMs) {
    for (var minutes = 8 * 60; minutes <= 20 * 60 + 30; minutes += 15) {
      var hour = Math.floor(minutes / 60);
      var minute = minutes % 60;
      var time = (hour < 10 ? '0' : '') + hour + ':' + (minute < 10 ? '0' : '') + minute;
      if (Date.parse(date + 'T' + time + ':00+03:00') > nowMs) return true;
    }
    return false;
  }

  function refreshCommentTimes(now) {
    if (!commentDate || !commentTime) return;
    var date = commentDate.value;
    var selectedTime = commentTime.value;
    while (commentTime.options.length > 1) commentTime.remove(1);

    var available = 0;
    if (date && commentDates[date]) {
      for (var minutes = 8 * 60; minutes <= 20 * 60 + 30; minutes += 15) {
        var hour = Math.floor(minutes / 60);
        var minute = minutes % 60;
        var time = (hour < 10 ? '0' : '') + hour + ':' + (minute < 10 ? '0' : '') + minute;
        if (Date.parse(date + 'T' + time + ':00+03:00') <= now.getTime()) continue;
        var option = el('option', '', time);
        option.value = time;
        commentTime.appendChild(option);
        available++;
      }
    }

    commentTime.value = selectedTime;
    if (commentTime.value !== selectedTime) commentTime.selectedIndex = 0;
    commentTime.disabled = !date || available === 0;
  }

  function refreshCommentDates() {
    if (!commentDate || !commentTime) return;
    var now = new Date();
    var nowMs = now.getTime();
    var today = moscowDateKey(now);
    var selectedDate = commentDate.value;
    while (commentDate.options.length > 1) commentDate.remove(1);

    var available = 0;
    for (var i = 0; i < commentDateKeys.length; i++) {
      var date = commentDateKeys[i];
      if (date < today || !hasFutureCommentTime(date, nowMs)) continue;
      var option = el('option', '', commentDates[date]);
      option.value = date;
      commentDate.appendChild(option);
      available++;
    }

    commentDate.value = selectedDate;
    if (commentDate.value !== selectedDate) commentDate.selectedIndex = 0;
    commentDate.disabled = available === 0;
    refreshCommentTimes(now);
  }

  function updateComment() {
    if (!commentEl || !commentCopy || !commentDate || !commentTime || !commentName || !commentPhone) return;
    var date = commentDate.value;
    var time = commentTime.value;
    var name = commentName.value.trim();
    var phone = commentPhone.value.trim();
    var validTime = /^(0[8-9]|1\d|20):(00|15|30|45)$/.test(time) && time <= '20:30' &&
      Date.parse(date + 'T' + time + ':00+03:00') > Date.now() &&
      date >= moscowDateKey(new Date());

    if (!commentDates[date] || !validTime || !name || !phone) {
     commentEl.textContent = 'Выберите будущие дату и время, введите имя и номер телефона.';
     commentCopy.disabled = true;
     return;
    }

    commentEl.textContent = 'Дата получения: ' + commentDates[date] + ', к ' + time + '. Имя: ' + name + '. Номер телефона: ' + phone + '.';
    commentCopy.disabled = false;
  }

  if (commentDate && commentTime && commentName && commentPhone) {
    commentDate.addEventListener('change', function () {
      refreshCommentTimes(new Date());
      updateComment();
    });
    commentTime.addEventListener('change', updateComment);
    commentName.addEventListener('input', updateComment);
    commentPhone.addEventListener('input', updateComment);
    refreshCommentDates();
    window.setInterval(function () {
      refreshCommentDates();
      updateComment();
    }, 15000);
  }

  function flashComment(message) {
    if (!commentStatus) return;
    commentStatus.textContent = message;
    if (commentStatus.__mdTimer) clearTimeout(commentStatus.__mdTimer);
    commentStatus.__mdTimer = setTimeout(function () { commentStatus.textContent = ''; }, 4000);
  }

  if (commentCopy && commentEl) {
    commentCopy.addEventListener('click', function () {
      updateComment();
      if (commentCopy.disabled) return;
      var text = commentEl.textContent;
      reachGoal(GOALS.promoCopy, { place: 'comment' });
      copyText(text, function (ok) {
        flashComment(ok
          ? 'Комментарий скопирован — вставьте его в поле «Комментарий» в приложении.'
          : 'Не удалось скопировать автоматически — скопируйте комментарий вручную: ' + text);
      });
    });
  }

  /* ---------- 6. цели по кликам ----------
     Разметка помечает действия атрибутом data-goal, поэтому обработчик один и он же
     не мешает переходу по ссылке: сначала ставим цель, потом браузер делает своё. */
  doc.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-goal]') : null;
    if (!el) return;
    var params = {};
    if (el.getAttribute('data-product')) params.product = el.getAttribute('data-product');
    if (el.getAttribute('data-goal-param')) params.place = el.getAttribute('data-goal-param');
    reachGoal(el.getAttribute('data-goal'), params);
  });

  /* ---------- 7. условия, пекарни и режим витрины ---------- */
  var termsList = doc.querySelector('[data-md-terms]');
  var terms = isShowcase && CONFIG.showcase ? CONFIG.showcase.terms : CONFIG.terms;
  if (termsList && terms) {
    for (var t = 0; t < terms.length; t++) {
      termsList.appendChild(el('li', '', terms[t]));
    }
  }

  /* Адреса пекарен: карточка «Купить в пекарне». Данные — contact.bakeries из конфига,
     поэтому адрес с картой не дублируется в разметке и не расходится с главной.
     Без JS список остаётся пустым, но карточка не врёт: текст над ним называет срок. */
  var bakeryList = doc.querySelector('[data-md-bakeries]');
  if (bakeryList && CONFIG.contact && CONFIG.contact.bakeries) {
    for (var b = 0; b < CONFIG.contact.bakeries.length; b++) {
      var bakery = CONFIG.contact.bakeries[b];
      var link = el('a', 'md-bakery');
      link.href = bakery.map;
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('data-goal', 'bakery_visit_click');
      link.setAttribute('data-goal-param', bakery.id);
      link.appendChild(icon('i-pin', 18));
      var addr = el('span', '', bakery.address);
      addr.appendChild(el('small', '', bakery.hours));
      link.appendChild(addr);
      var item = el('li');
      item.appendChild(link);
      bakeryList.appendChild(item);
    }
  }

  var showcase = CONFIG.showcase || {};
  var heroNote = doc.querySelector('[data-md-hero-note]');
  if (isShowcase && heroNote && showcase.heroNote) heroNote.textContent = showcase.heroNote;
  var saleMessage = doc.querySelector('[data-md-sale-message]');
  if (isShowcase && saleMessage && showcase.saleMessage) saleMessage.textContent = showcase.saleMessage;

  /* ---------- 8. год ---------- */
  var year = doc.getElementById('mdYear');
  if (year) {
    try {
      year.textContent = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric' }).format(new Date());
    } catch (e) {
      year.textContent = String(new Date().getFullYear());
    }
  }

  /* ---------- 9. просмотр страницы ---------- */
  reachGoal(GOALS.pageView, { mode: root.getAttribute('data-md-mode') || '' });
  if ('IntersectionObserver' in window) {
    var mdCards = doc.querySelectorAll('.menu-card--product');
    var mdReveal = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('is-in');
          mdReveal.unobserve(entries[i].target);
        }
      }
    }, { threshold: 0.15 });
    for (var j = 0; j < mdCards.length; j++) {
      mdReveal.observe(mdCards[j]);
    }
  }
})();
