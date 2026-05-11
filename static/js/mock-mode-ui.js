/* global isMockMode, setMockMode, toggleMockMode */

function _setMockBanner(enabled, reason) {
  const banner = document.getElementById('mockBanner');
  if (!banner) return;
  banner.classList.toggle('hidden', !enabled);
  const r = document.getElementById('mockReason');
  if (r) r.textContent = reason ? String(reason) : 'API unreachable';
}

function _syncMockToggle(enabled) {
  const t = document.getElementById('mockModeToggle');
  if (t && typeof t.checked === 'boolean') t.checked = !!enabled;
}

document.addEventListener('DOMContentLoaded', () => {
  _setMockBanner(isMockMode(), 'manual');
  _syncMockToggle(isMockMode());

  const t = document.getElementById('mockModeToggle');
  if (t) {
    t.addEventListener('change', () => {
      setMockMode(!!t.checked, 'manual');
    });
  }

  window.addEventListener('mockmodechange', (ev) => {
    const enabled = !!ev?.detail?.enabled;
    _setMockBanner(enabled, ev?.detail?.reason);
    _syncMockToggle(enabled);
  });

  const btn = document.getElementById('mockToggleBtn');
  if (btn) btn.addEventListener('click', () => toggleMockMode());
});

