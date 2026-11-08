const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("navigation");
for (const photo of document.querySelectorAll('.directory-photo img')) {
  const removeUnavailablePhoto = () => {
    const frame = photo.closest('.directory-photo');
    frame.querySelector('.directory-photo-placeholder').hidden = false;
    photo.closest('a').remove();
  };
  photo.addEventListener('error', removeUnavailablePhoto, { once: true });
  if (photo.complete && !photo.naturalWidth) removeUnavailablePhoto();
}
const pgActionForms = document.querySelectorAll('form[data-save-pg], form[data-compare-pg]');
if (pgActionForms.length || document.querySelector('.compare-page')) {
  // A browser Back restore can bypass the server's comparison reset.
  window.addEventListener('pageshow', event => {
    if (event.persisted) location.reload();
  });
}
if (pgActionForms.length) {
  const notice = document.createElement('div');
  notice.className = 'save-notice';
  notice.setAttribute('role', 'status');
  document.body.append(notice);
  let noticeTimer;
  let comparisonRequests = Promise.resolve();

  function showSaveNotice(message, openComparison = false) {
    clearTimeout(noticeTimer);
    notice.textContent = message;
    if (openComparison) {
      const link = document.createElement('a');
      link.href = '/compare';
      link.textContent = 'View comparison';
      notice.append(' ', link);
    }
    notice.classList.add('is-visible');
    noticeTimer = setTimeout(() => {
      notice.classList.remove('is-visible');
      notice.textContent = '';
    }, openComparison ? 6000 : 2800);
  }

  for (const form of pgActionForms) {
    const comparing = form.hasAttribute('data-compare-pg');
    const name = comparing ? form.dataset.comparePg : form.dataset.savePg;
    const button = form.querySelector('button');
    const label = button.querySelector(comparing ? '[data-compare-label]' : '[data-save-label]');
    const action = form.elements.namedItem('action');
    let pending = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending) return;
      pending = true;
      button.setAttribute('aria-busy', 'true');
      try {
        const send = () => fetch(form.action, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new URLSearchParams(new FormData(form)),
        });
        const response = await (comparing
          ? (comparisonRequests = comparisonRequests.catch(() => undefined).then(send))
          : send());
        if (response.redirected && new URL(response.url).pathname === '/login') {
          showSaveNotice('Your session ended. Log in to save PGs.');
          return;
        }
        if (comparing && response.status === 400) {
          showSaveNotice('You can compare up to three PGs. Remove one to add another.', true);
          return;
        }
        if (!response.ok) throw Error('PG action failed');
        if (comparing) {
          const { compared } = await response.json();
          if (typeof compared !== 'boolean') throw Error('Unexpected comparison response');
          action.value = compared ? 'remove' : 'add';
          label.textContent = compared ? 'Compared' : 'Compare';
          button.setAttribute('aria-label', compared ? 'Remove ' + name + ' from comparison' : 'Compare ' + name);
          showSaveNotice(compared ? 'Added to comparison.' : 'Removed from comparison.', compared);
          return;
        }
        const { saved } = await response.json();
        if (typeof saved !== 'boolean') throw Error('Unexpected save response');
        action.value = saved ? 'remove' : 'add';
        button.dataset.saved = String(saved);
        if (label) label.textContent = saved ? 'Saved' : 'Save PG';
        button.setAttribute('aria-label', saved
          ? 'Remove ' + name + ' from saved PGs'
          : 'Save ' + name);
        if (saved && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          button.querySelector('.ui-icon')?.animate?.(
            [{ transform: 'scale(.86)' }, { transform: 'scale(1.34)' }, { transform: 'scale(1)' }],
            { duration: 320, easing: 'cubic-bezier(.2,.75,.3,1)' },
          );
        }
        showSaveNotice(saved ? 'Added to Saved PGs' : 'Removed from Saved PGs');
      } catch {
        showSaveNotice(comparing ? 'Couldn’t update the comparison. Try again.' : 'Couldn’t update Saved PGs. Try again.');
      } finally {
        pending = false;
        button.removeAttribute('aria-busy');
      }
    });
  }
}
for (const link of document.querySelectorAll('[data-nav]')) {
  const destination = new URL(link.href);
  if (destination.pathname === location.pathname && destination.search === location.search)
    link.setAttribute('aria-current', 'page');
}
document.addEventListener('click', event => {
  for (const profile of document.querySelectorAll('.profile[open]'))
    if (!profile.contains(event.target)) profile.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const profile = document.querySelector('.profile[open]');
  if (profile) { profile.open = false; profile.querySelector('summary').focus(); }
  if (nav?.classList.contains('open')) {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }
});
if (toggle)
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    nav.classList.toggle("open", !expanded);
  });
for (const input of document.querySelectorAll("input[data-preview]")) {
  let urls = [];
  input.addEventListener("change", () => {
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    const container = document.getElementById(input.dataset.preview);
    container.replaceChildren();
    for (const file of input.files) {
      const tile = document.createElement("span");
      const name = document.createElement("small");
      name.textContent = file.name;
      if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        const img = document.createElement("img");
        img.alt = file.name + " — selected, not yet uploaded";
        const url = URL.createObjectURL(file);
        urls.push(url);
        img.src = url;
        tile.append(img);
      }
      tile.append(name);
      container.append(tile);
    }
  });
}
for (const form of document.querySelectorAll(".property-upload,.upload-form"))
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector(".upload-status");
    const buttons = [
      ...form.querySelectorAll("button[type=submit],button:not([type]),[data-step-target],[data-step-back],[data-step-next]"),
    ];
    const data = new FormData(form);
    if (event.submitter?.name)
      data.set(event.submitter.name, event.submitter.value);
    if (form.classList.contains("property-upload") && !data.has("intent"))
      data.set("intent", "submit");
    if (form.classList.contains("property-upload") && data.get("intent") !== "draft") {
      const description = form.elements.namedItem("description");
      if (description.value.trim().split(/\s+/).filter(Boolean).length < 12) {
        status.textContent = "Add a description of at least 80 characters and 12 words before submitting to admin.";
        description.focus();
        return;
      }
    }
    const files = [...data.values()].filter(
      (v) => v instanceof File && v.size > 0,
    );
    if (files.some((f) => f.size > 4 * 1024 * 1024)) {
      status.textContent =
        "Each uploaded photo or document must be no larger than 4 MB.";
      return;
    }
    if(files.reduce((total,file)=>total+file.size,0)>23*1024*1024){status.textContent='Keep each upload batch below 23 MB. Add the remaining photos in another save.';return;}
    const photoFiles = [...data.entries()]
      .filter(
        ([key, value]) =>
          value instanceof File &&
          value.size > 0 &&
          key !== "authorizationFiles",
      )
      .map(([, value]) => value);
    const documentFiles = [...data.entries()]
      .filter(
        ([key, value]) =>
          key === "authorizationFiles" &&
          value instanceof File &&
          value.size > 0,
      )
      .map(([, value]) => value);
    if (
      photoFiles.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp"].includes(file.type),
      )
    ) {
      status.textContent = "Choose JPEG, PNG or WebP photographs.";
      return;
    }
    if (
      documentFiles.some(
        (file) =>
          ![
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp",
          ].includes(file.type),
      )
    ) {
      status.textContent =
        "Authorization documents must be PDF, JPEG, PNG or WebP.";
      return;
    }
    if (
      form.classList.contains("property-upload") &&
      photoFiles.length + Number(form.dataset.existing) > 12
    ) {
      status.textContent = "Maximum 12 property photographs in total.";
      return;
    }
    if (
      documentFiles.length + Number(form.dataset.existingDocuments || 0) >
      3
    ) {
      status.textContent =
        "Maximum 3 authorization documents in total. Remove an old document before replacing it.";
      return;
    }
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = files.length
      ? "Saving your PG and preparing " + files.length + " file(s)…"
      : "Saving your PG…";
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: {
          "x-csrf-token": form.dataset.token,
          Accept: "application/json",
        },
        body: data,
      });
      if (response.headers.get("content-type")?.includes("application/json")) {
        const result = await response.json();
        if (result.redirectTo && (response.ok || response.status === 422)) {
          window.location.assign(result.redirectTo);
          return;
        }
        status.textContent =
          result.message ||
          "The PG was not submitted. Please check the details and try again.";
        status.scrollIntoView({ block: "center", behavior: "auto" });
        return;
      }
      if (response.ok && response.redirected) {
        window.location.assign(response.url);
        return;
      }
      const text = await response.text();
      const doc = new DOMParser().parseFromString(text, "text/html");
      status.textContent =
        doc.querySelector("[role=alert]")?.textContent ||
        "The action could not be completed. Your entries are still here; please check them and try again.";
      status.scrollIntoView({ block: "center", behavior: "auto" });
    } catch (error) {
      status.textContent =
        "Connection interrupted. Your entries are still here. Check your dashboard before retrying.";
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
const viewer = document.querySelector(".photo-viewer");
const photos = [...document.querySelectorAll(".gallery-photo")];
if (viewer && photos.length) {
  if (typeof viewer.showModal === "function") {
    photos[0].closest(".property-gallery")?.classList.add("property-gallery-preview");
  }
  let current = 0;
  const display = (index) => {
    current = (index + photos.length) % photos.length;
    const photo = photos[current];
    const image = viewer.querySelector(".viewer-image");
    image.src = photo.href;
    image.alt = photo.dataset.caption;
    viewer.querySelector(".viewer-caption").textContent = photo.dataset.caption;
    viewer.querySelector(".viewer-counter").textContent =
      "Photo " + (current + 1) + " of " + photos.length;
  };
  photos.forEach((photo, index) =>
    photo.addEventListener("click", (event) => {
      if (typeof viewer.showModal !== "function") return;
      event.preventDefault();
      display(index);
      viewer.showModal();
    }),
  );
  viewer
    .querySelector(".viewer-close")
    .addEventListener("click", () => viewer.close());
  viewer
    .querySelector(".viewer-previous")
    .addEventListener("click", () => display(current - 1));
  viewer
    .querySelector(".viewer-next")
    .addEventListener("click", () => display(current + 1));
  viewer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      display(current - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      display(current + 1);
    }
  });
}

// Keep mobile results visible; native details keeps filters usable without JavaScript.
const searchFilters = document.querySelector('.filter-disclosure');
if (searchFilters && window.matchMedia('(max-width: 800px)').matches) {
  searchFilters.open = false;
}

// Email tokens stay in the URL fragment and are removed before any navigation.
for(const form of document.querySelectorAll('[data-token-form]')){
 const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
 history.replaceState(null,'',location.pathname);
 const field=form.querySelector('[name="token"]');field.value=token;
 const valid=/^[a-f0-9]{64}$/.test(token);
 form.querySelector('button').disabled=!valid;
 form.querySelector('[data-token-status]').textContent=valid?'Your one-time link is ready. Confirm below.':'This link is missing its verification token. Open the full email link or request another.';
}
