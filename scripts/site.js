(function () {
  const body = document.body;
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('.site-nav');
  const backdrop = document.querySelector('[data-nav-backdrop]');

  function setMenuState(isOpen) {
    body.classList.toggle('nav-open', isOpen);

    if (toggle) {
      toggle.setAttribute('aria-expanded', String(isOpen));
    }

    if (backdrop) {
      backdrop.hidden = !isOpen;
    }
  }

  if (toggle && nav) {
    setMenuState(false);

    toggle.addEventListener('click', function () {
      setMenuState(!body.classList.contains('nav-open'));
    });

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        setMenuState(false);
      });
    });

    if (backdrop) {
      backdrop.addEventListener('click', function () {
        setMenuState(false);
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setMenuState(false);
      }
    });

    const desktopQuery = window.matchMedia('(min-width: 769px)');
    const closeOnDesktop = function (event) {
      if (event.matches) {
        setMenuState(false);
      }
    };

    if (typeof desktopQuery.addEventListener === 'function') {
      desktopQuery.addEventListener('change', closeOnDesktop);
    } else if (typeof desktopQuery.addListener === 'function') {
      desktopQuery.addListener(closeOnDesktop);
    }
  }

  window.toggleTooltip = function (tooltipId) {
    const tooltip = document.getElementById(tooltipId);
    if (!tooltip) return;

    document.querySelectorAll('.tooltip.show').forEach(function (openTooltip) {
      if (openTooltip !== tooltip) {
        openTooltip.classList.remove('show');
      }
    });

    tooltip.classList.toggle('show');
  };

  document.addEventListener('click', function (event) {
    if (event.target.closest('.info-icon') || event.target.closest('.tooltip')) {
      return;
    }

    document.querySelectorAll('.tooltip.show').forEach(function (tooltip) {
      tooltip.classList.remove('show');
    });
  });

  // WhatsApp button click tracking
  function handleWaClick(event) {
    if (typeof window.plausible !== 'function') return;

    var el = event.currentTarget;

    if (el.classList.contains('nav-order')) {
      window.plausible('Nav Order Click');
      return;
    }

    var href = el.getAttribute('href') || '';
    var product = 'general';
    try {
      var msgText = decodeURIComponent((href.split('text=')[1] || '').replace(/\+/g, ' '));
      var match = msgText.match(/order(?:\s+the)?\s+([\w\s-]+?)(?:\s+for\b|\.|$)/i);
      if (match && match[1].trim().length > 2 && match[1].indexOf('__') === -1) {
        product = match[1].trim().toLowerCase().replace(/\s+/g, '-');
      }
    } catch (e) { /* ignore */ }

    window.plausible('Order Click', { props: { product: product } });
  }

  document.querySelectorAll('.nav-order, .btn[href*="wa.me"]').forEach(function (el) {
    el.addEventListener('click', handleWaClick);
  });
})();
