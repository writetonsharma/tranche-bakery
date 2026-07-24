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

  function revealHashTarget() {
    if (!window.location.hash) return;

    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (!target) return;

    const details = target.matches('details') ? target : target.closest('details');
    if (details) {
      details.open = true;
    }

    window.requestAnimationFrame(function () {
      target.scrollIntoView({ block: 'start' });
    });
  }

  revealHashTarget();
  window.addEventListener('hashchange', revealHashTarget);

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

})();
