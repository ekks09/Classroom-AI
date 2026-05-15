/* ============================================================
   js/mock-mode-ui.js — Mock mode banner + toggle wiring
   ============================================================ */

'use strict';

/* global isMockMode, setMockMode, Logger */

const MockModeUI = (() => {

  function init() {
    updateAll();
    bindControls();
    window.addEventListener('mockmodechange', updateAll);
  }

  function updateAll() {
    const mock = isMockMode();

    // Banner
    const banner = document.getElementById('mockBanner');
    if (banner) banner.classList.toggle('hidden', !mock);

    // Toggle checkbox
    const toggle = document.getElementById('mockModeToggle');
    if (toggle) toggle.checked = mock;

    // Mock dot in topbar (if present)
    const dot = document.getElementById('mockDot');
    if (dot) {
      dot.className = 'sdot' + (mock ? ' loading' : '');
    }

    Logger.debug('mock-ui', 'Mock mode UI updated', { mock });
  }

  function bindControls() {
    // Toggle checkbox
    const toggle = document.getElementById('mockModeToggle');
    toggle?.addEventListener('change', () => {
      setMockMode(toggle.checked, 'manual');
    });

    // Banner disable button
    const btn = document.getElementById('mockToggleBtn');
    btn?.addEventListener('click', () => {
      setMockMode(!isMockMode(), 'manual');
    });
  }

  // Try to auto-enable mock mode on API failure
  function autoEnableOnFailure(reason) {
    if (!isMockMode()) {
      setMockMode(true, reason);
      const reasonEl = document.getElementById('mockReason');
      if (reasonEl) reasonEl.textContent = reason;
      Logger.warn('mock-ui', 'Auto-enabled mock mode', { reason });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { autoEnableOnFailure, updateAll };

})();

window.MockModeUI = MockModeUI;