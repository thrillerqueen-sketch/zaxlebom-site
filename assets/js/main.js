/* за Хлебом — zaxlebom.ru
   Small, dependency-free enhancement layer. The page is fully readable without it. */
(function () {
  'use strict';

  var doc = document;

  /* ---------- 1. icon sprite ----------
     The sprite lives in a separate file so the doodles render once and stay cacheable.
     Appended to <body> so <use href="#id"> resolves.
     _headers caches this file for a year as immutable, so the version here is the only
     thing that can bust it: bump it whenever icons.svg changes. */
  var SPRITE = '/assets/img/icons.svg?v=3';

  function loadSprite() {
    if (!doc.querySelector('use')) return;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', SPRITE, true);
    xhr.onload = function () {
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
        var holder = doc.createElement('div');
        holder.setAttribute('aria-hidden', 'true');
        holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        holder.innerHTML = xhr.responseText;
        doc.body.insertBefore(holder, doc.body.firstChild);
      }
    };
    xhr.send();
  }
  loadSprite();

  /* ---------- 2. opening hours ----------
     Stores are open 08:00-21:00 every day, Moscow time. Computing in Europe/Moscow
     explicitly means a visitor in another timezone still sees the real status. */
  var OPENS = 8, CLOSES = 21;

  function moscowNow() {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(new Date());
      var h = 0, m = 0, i;
      for (i = 0; i < parts.length; i++) {
        if (parts[i].type === 'hour') h = parseInt(parts[i].value, 10) % 24;
        if (parts[i].type === 'minute') m = parseInt(parts[i].value, 10);
      }
      return h + m / 60;
    } catch (e) {
      var d = new Date();               /* fallback: visitor's own clock */
      return d.getHours() + d.getMinutes() / 60;
    }
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function renderStatus() {
    var now = moscowNow();
    var open = now >= OPENS && now < CLOSES;
    var statuses = doc.querySelectorAll('[data-status]');
    for (var i = 0; i < statuses.length; i++) {
      var el = statuses[i];
      el.classList.toggle('is-open', open);
      el.classList.toggle('is-closed', !open);
      el.textContent = open
        ? 'Открыто до ' + pad(CLOSES) + ':00'
        : (now < OPENS ? 'Откроется в ' + pad(OPENS) + ':00' : 'Закрыто');
      el.title = 'Время московское';
    }
  }

  /* ---------- 3. header: stuck state, mobile nav ---------- */
  var header = doc.querySelector('.site-header');
  var navToggle = doc.getElementById('navToggle');
  var nav = doc.getElementById('nav');
  var panelCta = doc.querySelector('.btn-nav-cta');
  var headerCta = doc.querySelector('.header-cta');

  if (header) {
    var onScroll = function () { header.classList.toggle('is-stuck', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function closeNav() {
    if (!header) return;
    header.classList.remove('nav-open');
    if (navToggle) {
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.setAttribute('aria-label', 'Открыть меню');
    }
    setPanelCta(false);
  }

  /* The CTA at the bottom of the mobile panel is a real link, but it must not be
     reachable while the panel is closed, and screen readers should hear one CTA
     on desktop, not two. */
  function setPanelCta(open) {
    if (panelCta) {
      panelCta.setAttribute('tabindex', open ? '0' : '-1');
      if (open) panelCta.removeAttribute('aria-hidden');
      else panelCta.setAttribute('aria-hidden', 'true');
    }
    if (headerCta) {
      if (open) headerCta.setAttribute('aria-hidden', 'true');
      else headerCta.removeAttribute('aria-hidden');
    }
  }

  if (navToggle && header) {
    navToggle.addEventListener('click', function () {
      var isOpen = header.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
      navToggle.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
      setPanelCta(isOpen);
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
    if (nav) nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') closeNav(); });
  }


  /* ---------- 4. active nav link ---------- */
  var navLinks = nav ? Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]')) : [];
  if (navLinks.length && 'IntersectionObserver' in window) {
    var targets = [];
    navLinks.forEach(function (a) {
      var t = doc.querySelector(a.getAttribute('href'));
      if (t) targets.push({ link: a, section: t });
    });
    var io = new IntersectionObserver(function () {
      /* Several sections can touch the thin line at once (or none, in the gap between
         them), and entries arrive in DOM order — so the "last intersecting" link wins
         and jumps forward. Pick the section nearest the reading line instead. */
      var line = window.innerHeight * 0.45;
      var best = null;
      var bestDist = Infinity;
      for (var i = 0; i < targets.length; i++) {
        var box = targets[i].section.getBoundingClientRect();
        var dist = Math.abs(box.top - line);
        if (box.bottom > line - 1 && dist < bestDist) { bestDist = dist; best = targets[i]; }
      }
      navLinks.forEach(function (a) { a.classList.remove('is-active'); });
      if (best) best.link.classList.add('is-active');
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    targets.forEach(function (t) { io.observe(t.section); });
  }

  /* ---------- 5. sticky install bar ----------
     Small screens only, after the hero is scrolled past, and never over the install
     section itself. Dismissal is remembered for the session. */
  var bar = doc.getElementById('installBar');
  var barClose = doc.getElementById('installBarClose');
  var installSection = doc.getElementById('install');
  var barDismissed = false;
  try { barDismissed = sessionStorage.getItem('zh-hidebar') === '1'; } catch (e) {}
  if (!bar) barDismissed = true;

  function updateBar() {
    if (!bar || barDismissed) return;
    var small = window.matchMedia('(max-width: 900px)').matches;
    var pastHero = window.scrollY > window.innerHeight * 0.75;
    var atInstall = false;
    if (installSection) {
      var r = installSection.getBoundingClientRect();
      atInstall = r.top < window.innerHeight && r.bottom > 0;
    }
    var show = small && pastHero && !atInstall;
    if (show && bar.hidden) {
      bar.hidden = false;
      window.requestAnimationFrame(function () { bar.classList.add('is-visible'); });
    } else if (!show && !bar.hidden) {
      bar.classList.remove('is-visible');
      window.setTimeout(function () { if (!bar.classList.contains('is-visible')) bar.hidden = true; }, 320);
    }
  }

  function hideBar() {
    barDismissed = true;
    try { sessionStorage.setItem('zh-hidebar', '1'); } catch (e) {}
    bar.classList.remove('is-visible');
    window.setTimeout(function () { bar.hidden = true; }, 320);
  }

  if (bar) {
    window.addEventListener('scroll', updateBar, { passive: true });
    window.addEventListener('resize', updateBar, { passive: true });
    updateBar();
    if (barClose) barClose.addEventListener('click', hideBar);
  }

  /* ---------- 6. install hand-off ----------
     On a phone the sticky button goes straight to the matching store.
     Desktop keeps the in-page jump to the block with both badges. */
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);
  var storeURL = isIOS
    ? 'https://apps.apple.com/ru/app/id6473427557'
    : (isAndroid ? 'https://play.google.com/store/apps/details?id=ru.foodapp.loyalty.zahlebom' : '');
  var barBtn = doc.getElementById('installBarBtn');
  if (barBtn && storeURL) {
    barBtn.href = storeURL;
    barBtn.setAttribute('rel', 'noopener');
  }

  /* The QR block is desktop only (05-responsive.css), so on a phone the two
     "Приложение" buttons cannot jump to it — they go to the store instead. */
  var qrBlock = doc.getElementById('install');
  if (storeURL && qrBlock && window.getComputedStyle(qrBlock).display === 'none') {
    var installLinks = doc.querySelectorAll('[data-cta="header-install"], [data-cta="menu-install"]');
    Array.prototype.forEach.call(installLinks, function (a) {
      a.href = storeURL;
      a.setAttribute('rel', 'noopener');
    });
  }

  /* ---------- 7. year (Moscow, so it never lags behind) ---------- */
  var year = doc.getElementById('year');
  if (year) {
    try {
      year.textContent = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric' }).format(new Date());
    } catch (e) {
      year.textContent = String(new Date().getFullYear());
    }
  }

  /* ---------- 8. CTA hook ----------
     No analytics is loaded by default (privacy, zero dependencies). Every outbound
     action carries data-cta="<name>" and fires a `zh:cta` event, so adding a counter
     later is a one-liner at the marked spot. */
  doc.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-cta]') : null;
    if (!el) return;
    var name = el.getAttribute('data-cta');
    // window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: 'cta', cta: name });
    doc.dispatchEvent(new CustomEvent('zh:cta', { detail: { name: name } }));
  });

  /* ---------- 9. phone drift ----------
     The two app screenshots separate slightly as the section passes through the
     viewport: +1 at the top edge, -1 at the bottom, so the phones settle into place
     as you arrive and part again as you leave. Depth comes from the two ranges in
     CSS (.phone-left/-right --drift-range), not from here. Only the phone that is
     actually on screen gets written to, and only while it is. Skipped entirely when
     the user asked for reduced motion or the browser cannot measure the section. */
  var phoneStage = doc.querySelector('.phones');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (phoneStage && !reducedMotion.matches) {
    var phones = phoneStage.querySelectorAll('.phone');
    var driftTick = false;
    var stageVisible = false;

    var applyDrift = function () {
      driftTick = false;
      if (!stageVisible) {
        for (var i = 0; i < phones.length; i++) phones[i].style.removeProperty('--drift');
        return;
      }
      var r = phoneStage.getBoundingClientRect();
      // -1 just as the stage enters from the bottom, +1 just as it leaves from the top
      var progress = (window.innerHeight - r.top) / (window.innerHeight + r.height);
      progress = Math.max(0, Math.min(1, progress));
      var eased = (progress - 0.5) * 2;
      for (var j = 0; j < phones.length; j++) {
        var range = parseFloat(getComputedStyle(phones[j]).getPropertyValue('--drift-range')) || 0;
        phones[j].style.setProperty('--drift', (eased * range).toFixed(2) + 'px');
      }
    };

    var requestDrift = function () {
      if (driftTick) return;
      driftTick = true;
      window.requestAnimationFrame(applyDrift);
    };

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        stageVisible = entries[0].isIntersecting;
        requestDrift();
      }, { rootMargin: '120px 0px' }).observe(phoneStage);
    } else {
      stageVisible = true;
    }
    window.addEventListener('scroll', requestDrift, { passive: true });
    window.addEventListener('resize', requestDrift, { passive: true });
    // older Safari has only addListener here; failing to bind must not break the module
    var onMotionChange = function () {
      if (reducedMotion.matches) {
        for (var k = 0; k < phones.length; k++) phones[k].style.removeProperty('--drift');
      } else {
        requestDrift();
      }
    };
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionChange);
    else if (reducedMotion.addListener) reducedMotion.addListener(onMotionChange);
    requestDrift();
  }

  /* ---------- 10. keep the status fresh ---------- */
  renderStatus();
  window.setInterval(renderStatus, 60 * 1000);

  /* ---------- 11. hero carousel ----------
     Автопрокрутка, кнопки-точки и свайп управляют лентой слайдов.
     При фокусе или касании таймер останавливается; при reduced motion автопрокрутки нет.
     Неактивные слайды исключены из фокуса атрибутом inert и скрыты от скринридера. */
  var carousel = doc.querySelector('[data-carousel]');
  if (carousel) {
    var slidesTrack = carousel.querySelector('.hero-slides');
    var slides = carousel.querySelectorAll('.hero-slide');
    var dots = carousel.querySelectorAll('.hero-dot');
    var slideIndex = 0;
    var autoTimer = null;
    var AUTOPLAY = 6500;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function showSlide(n) {
      if (!slides.length || !slidesTrack) return;
      slideIndex = (n + slides.length) % slides.length;
      slidesTrack.style.transform = 'translateX(-' + (slideIndex * 100) + '%)';
      for (var i = 0; i < slides.length; i++) {
        var on = i === slideIndex;
        slides[i].classList.toggle('is-active', on);
        slides[i].setAttribute('aria-hidden', on ? 'false' : 'true');
        if (on) { slides[i].removeAttribute('inert'); } else { slides[i].setAttribute('inert', ''); }
      }
      for (var j = 0; j < dots.length; j++) {
        var cur = j === slideIndex;
        dots[j].classList.toggle('is-active', cur);
        if (cur) { dots[j].setAttribute('aria-current', 'true'); } else { dots[j].removeAttribute('aria-current'); }
      }
    }
    function stopAuto() { if (autoTimer) { window.clearInterval(autoTimer); autoTimer = null; } }
    function startAuto() {
      if (reduceMotion || slides.length < 2) return;
      stopAuto();
      autoTimer = window.setInterval(function () { showSlide(slideIndex + 1); }, AUTOPLAY);
    }

    for (var di = 0; di < dots.length; di++) {
      (function (n) {
        dots[n].addEventListener('click', function () { showSlide(n); startAuto(); });
      })(di);
    }
    carousel.addEventListener('focusin', stopAuto);
    carousel.addEventListener('focusout', function (e) {
      if (!e.relatedTarget || !carousel.contains(e.relatedTarget)) startAuto();
    });

    var touchX = null;
    carousel.addEventListener('touchstart', function (e) {
      touchX = e.touches[0].clientX; stopAuto();
    }, { passive: true });
    carousel.addEventListener('touchend', function (e) {
      if (touchX === null) return;
      var dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 45) { showSlide(slideIndex + (dx < 0 ? 1 : -1)); }
      startAuto();
    }, { passive: true });
    carousel.addEventListener('touchcancel', function () {
      touchX = null;
      startAuto();
    }, { passive: true });

    showSlide(0);
    startAuto();
  }

  if ('IntersectionObserver' in window) {
    var revealEls = doc.querySelectorAll('.menu-card, .phones');
    var revealObserver = new IntersectionObserver(function (entries) {
      for (var r = 0; r < entries.length; r++) {
        if (entries[r].isIntersecting) {
          entries[r].target.classList.add('is-in');
          revealObserver.unobserve(entries[r].target);
        }
      }
    }, { threshold: 0.15 });
    for (var ri = 0; ri < revealEls.length; ri++) {
      revealObserver.observe(revealEls[ri]);
    }
  }
})();
