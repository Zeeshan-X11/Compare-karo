// Progressive enhancement: the complete, native form stays usable without JS.
const ownerWizard = document.querySelector('[data-property-wizard]');
if (ownerWizard) {
  const steps = [...ownerWizard.querySelectorAll('[data-step]')];
  const tabs = [...ownerWizard.querySelectorAll('[data-step-target]')];
  const back = ownerWizard.querySelector('[data-step-back]');
  const next = ownerWizard.querySelector('[data-step-next]');
  const submit = ownerWizard.querySelector('[data-step-submit]');
  const status = ownerWizard.querySelector('[data-step-status]');
  let current = 0;

  const show = (index, focus = true) => {
    current = index;
    steps.forEach((step, i) => { step.hidden = i !== current; });
    tabs.forEach((tab, i) => {
      if (i === current) tab.setAttribute('aria-current', 'step');
      else tab.removeAttribute('aria-current');
    });
    back.hidden = current === 0;
    next.hidden = current === steps.length - 1;
    submit.hidden = current !== steps.length - 1;
    const title = tabs[current].querySelector('.owner-step-label').textContent;
    status.textContent = 'Step ' + (current + 1) + ' of ' + steps.length + ' · ' + title;
    if (focus) {
      steps[current].querySelector('h2').focus({ preventScroll: true });
      ownerWizard.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  };

  const validate = (scope) => {
    const description = ownerWizard.elements.namedItem('description');
    const words = description.value.trim().split(/\s+/).filter(Boolean).length;
    description.setCustomValidity(description.value && words < 12
      ? 'Describe your PG in at least 80 characters and 12 words.' : '');
    const invalid = [...scope.querySelectorAll('input,select,textarea')]
      .find(field => field.willValidate && !field.validity.valid);
    if (!invalid) return true;
    const step = invalid.closest('[data-step]');
    if (step) show(Number(step.dataset.step), false);
    // Reveal optional groups too, so the browser can focus invalid inputs.
    for (let node = invalid.parentElement; node && node !== ownerWizard; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
    }
    invalid.focus();
    invalid.reportValidity();
    return false;
  };

  const advance = () => {
    if (validate(steps[current]) && current < steps.length - 1) show(current + 1);
  };

  // Native validation runs before submit events and cannot focus hidden steps.
  // Validate explicitly after revealing the relevant step; never disable fields.
  ownerWizard.noValidate = true;
  ownerWizard.classList.add('wizard-ready');
  ownerWizard.addEventListener('input', event => {
    if (event.target.name === 'description') event.target.setCustomValidity('');
  });
  back.addEventListener('click', () => show(Math.max(0, current - 1)));
  next.addEventListener('click', advance);
  tabs.forEach(tab => tab.addEventListener('click', () => show(Number(tab.dataset.stepTarget))));
  ownerWizard.addEventListener('submit', event => {
    if (event.submitter?.value === 'draft') return;
    if (current < steps.length - 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      advance();
    } else if (!validate(ownerWizard)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  show(0, false);
}

const locationPicker = document.querySelector('[data-location-picker]');
if (locationPicker) {
  const latitude = locationPicker.querySelector('[name="coordinateLatitude"]');
  const longitude = locationPicker.querySelector('[name="coordinateLongitude"]');
  const link = locationPicker.querySelector('[name="googleMapUrl"]');
  const consent = locationPicker.querySelector('[name="locationPublic"]');
  const status = locationPicker.querySelector('[data-location-status]');
  const useLocation = locationPicker.querySelector('[data-use-location]');
  const clearLocation = locationPicker.querySelector('[data-clear-location]');
  let requestId = 0;
  locationPicker.querySelector('[data-location-actions]').hidden = false;

  function stopCapture() {
    requestId++;
    useLocation.disabled = false;
  }

  locationPicker.closest('form').addEventListener('submit', event => {
    if (!useLocation.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    status.textContent = 'Wait for your location, or paste a Google Maps link to continue.';
  }, true);
  link.addEventListener('input', () => {
    stopCapture();
    if (link.value.trim()) latitude.value = longitude.value = '';
    status.textContent = latitude.value ? 'A property pin is selected.' : '';
  });
  clearLocation.addEventListener('click', () => {
    stopCapture();
    latitude.value = longitude.value = link.value = '';
    consent.checked = false;
    status.textContent = 'Location cleared. Save the form to apply the change.';
  });
  useLocation.addEventListener('click', () => {
    if (!navigator.geolocation || !window.isSecureContext) {
      status.textContent = 'Current location is unavailable here. Paste a Google Maps link instead.';
      return;
    }
    const captureId = ++requestId;
    useLocation.disabled = true;
    status.textContent = 'Getting your current location…';
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (captureId !== requestId) return;
      stopCapture();
      latitude.value = coords.latitude.toFixed(6);
      longitude.value = coords.longitude.toFixed(6);
      link.value = '';
      status.textContent = 'Current location selected. Save the form to submit it.';
    }, () => {
      if (captureId !== requestId) return;
      stopCapture();
      status.textContent = 'Couldn’t get your location. Check your browser permission or paste a Google Maps link.';
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}
