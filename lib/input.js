const {problem}=require('./errors');
const { amenities, sharing, scalar } = require("./filters");
const { localities } = require("./localities");
const { phone, dateInput } = require("./marketplace");
const list = (v) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);
function parse(body) {
  const out = {};
  for (const [key, max] of Object.entries({
    name: 120,
    description: 4000,
    address: 500,
    houseRules: 2000,
    contactName: 80,
    contactPhone: 20,
    sourceUrl: 1000,
  })) {
    out[key] = scalar(body[key]);
    if (out[key].length > max) throw problem(400,key + " is too long.");
  }
  for (const key of ["monthlyRent", "securityDeposit", "oneTimeFee"]) {
    const v = scalar(body[key]);
    if (v && !/^\d{1,7}$/.test(v)) throw problem(400,"Invalid " + key);
    out[key] = v ? Number(v) : null;
    if (key !== "monthlyRent" && out[key] > 1000000)
      throw problem(400,"Enter a plausible " + key + " amount.");
  }
  for (const [key, values] of Object.entries({
    locality: localities,
    propertyCategory: ["Men", "Women", "Co-living"],
    availabilityStatus: ["unknown", "available", "unavailable"],
  })) {
    out[key] = scalar(body[key]) || undefined;
    if (out[key] && !values.includes(out[key])) throw problem(400,"Invalid " + key);
  }
  out.sharingOptions = [...new Set(list(body.sharingOptions).filter((v) =>
    sharing.includes(v),
  ))];
  out.amenities = list(body.amenities).filter((v) => amenities.includes(v));
  out.foodOptions = list(body.foodOptions).filter((v) =>
    ["Breakfast", "Lunch", "Dinner"].includes(v),
  );
  out.foodIncluded =
    body.foodIncluded === "yes"
      ? true
      : body.foodIncluded === "no"
        ? false
        : null;
  out.roomOptions = out.sharingOptions.map((type) => {
    const key = type === "Four+" ? "FourPlus" : type;
    const value = { sharing: type };
    for (const [prefix, field] of [
      ["rent", "monthlyRent"],
      ["roomsTotal", "totalRooms"],
      ["roomsAvailable", "availableRooms"],
    ]) {
      const raw = scalar(body[prefix + key]);
      if (raw && !/^\d{1,7}$/.test(raw))
        throw problem(400,"Enter a valid " + type + " " + field + ".");
      value[field] = raw ? Number(raw) : null;
      if (
        field === "monthlyRent" &&
        value[field] != null &&
        (value[field] < Number(process.env.MIN_MONTHLY_RENT || 2000) ||
          value[field] > Number(process.env.MAX_MONTHLY_RENT || 100000))
      )
        throw problem(400,"Enter a plausible monthly rent for " + type + " sharing.");
      if (field !== "monthlyRent" && value[field] > 500)
        throw problem(400,"Room counts cannot exceed 500.");
    }
    if (
      value.availableRooms != null &&
      value.totalRooms != null &&
      value.availableRooms > value.totalRooms
    )
      throw problem(400,
        "Available rooms cannot exceed total rooms for " + type + " sharing.",
      );
    return value;
  });
  const knownRents = out.roomOptions
    .map((r) => r.monthlyRent)
    .filter((v) => v != null);
  if (knownRents.length) out.monthlyRent = Math.min(...knownRents);
  if (
    out.monthlyRent != null &&
    (out.monthlyRent < Number(process.env.MIN_MONTHLY_RENT || 2000) ||
      out.monthlyRent > Number(process.env.MAX_MONTHLY_RENT || 100000))
  )
    throw problem(400,
      "Enter a plausible monthly rent within the configured PG rent range.",
    );
  out.whatsappAllowed = body.whatsappAllowed === "yes";
  const lat = scalar(body.coordinateLatitude),
    lon = scalar(body.coordinateLongitude);
  if (Boolean(lat) !== Boolean(lon))
    throw problem(400,"Provide both latitude and longitude, or leave both blank.");
  if (
    lat &&
    (!Number.isFinite(Number(lat)) ||
      !Number.isFinite(Number(lon)) ||
      Math.abs(Number(lat)) > 90 ||
      Math.abs(Number(lon)) > 180)
  )
    throw problem(400,"Enter valid geographic coordinates.");
  out.coordinates = {
    latitude: lat ? Number(lat) : undefined,
    longitude: lon ? Number(lon) : undefined,
    verified: false,
    publicationAuthorized: body.locationPublic === "yes",
  };
  out.contactPublic = body.contactPublic === "yes";
  out.ownerAuthorized = body.ownerAuthorized === "yes";
  if (out.contactPhone) {
    const normalized = phone(out.contactPhone);
    if (!normalized)
      throw problem(400,
        "Enter a valid Indian mobile number. Placeholder, repeated and sequential numbers are not accepted.",
      );
    out.contactPhone = normalized;
  }
  if (out.sourceUrl && !/^https?:\/\//.test(out.sourceUrl))
    throw problem(400,"Source URL must use HTTP or HTTPS.");
  for (const key of [
    "availabilityConfirmedAt",
    "priceConfirmedAt",
    "sourceDate",
  ]) {
    out[key] = dateInput(
      scalar(body[key]),
      {
        availabilityConfirmedAt: "Availability confirmation date",
        priceConfirmedAt: "Price confirmation date",
        sourceDate: "Source date",
      }[key],
    );
  }
  return out;
}
function publishable(l) {
  return Boolean(
    l.name &&
    l.description &&
    l.address &&
    l.locality &&
    l.propertyCategory &&
    l.sharingOptions.length &&
    l.ownerAuthorized &&
    l.contactName &&
    l.contactPhone,
  );
}
function submissionIssues(listing) {
  const issues = [];
  try {
    const body={};
    for(const field of ['name','description','address','houseRules','contactName','contactPhone','sourceUrl','locality','propertyCategory','availabilityStatus','monthlyRent','securityDeposit','oneTimeFee'])body[field]=listing[field]==null?'':String(listing[field]);
    body.sharingOptions=listing.sharingOptions||[];
    for(const r of listing.roomOptions||[]){const key=r.sharing==='Four+'?'FourPlus':r.sharing;body['rent'+key]=r.monthlyRent==null?'':String(r.monthlyRent);body['roomsTotal'+key]=r.totalRooms==null?'':String(r.totalRooms);body['roomsAvailable'+key]=r.availableRooms==null?'':String(r.availableRooms);}
    for(const field of ['availabilityConfirmedAt','priceConfirmedAt','sourceDate'])if(listing[field])body[field]=new Date(listing[field]).toISOString().slice(0,10);
    if(listing.coordinates?.latitude!=null)body.coordinateLatitude=String(listing.coordinates.latitude);
    if(listing.coordinates?.longitude!=null)body.coordinateLongitude=String(listing.coordinates.longitude);
    const normalized=parse(body);
    if(normalized.monthlyRent!==listing.monthlyRent)issues.push('Starting rent must match the lowest sharing rent');
  }catch(error){issues.push(error.status===400?error.message:'Valid property field values and dates');}
  for (const [field, label] of Object.entries({
    name: "Property name",
    description: "Description",
    address: "Exact address",
    locality: "Locality",
    propertyCategory: "PG category",
    contactName: "Owner contact name",
    contactPhone: "Owner contact phone",
  }))
    if (!listing[field]) issues.push(label);
  if (!listing.sharingOptions?.length)
    issues.push("At least one sharing option");
  if (listing.name && listing.name.trim().length < 3)
    issues.push("A complete property name");
  if (
    listing.description &&
    (listing.description.trim().length < 80 ||
      listing.description.trim().split(/\s+/).length < 12)
  )
    issues.push("A useful description of at least 80 characters and 12 words");
  if (listing.address && listing.address.trim().length < 12)
    issues.push("A complete street address");
  if (listing.contactPhone && !phone(listing.contactPhone))
    issues.push("A valid non-placeholder Indian mobile number");
  for (const type of listing.sharingOptions || [])
    if (
      !(listing.roomOptions || []).some(
        (r) =>
          r.sharing === type &&
          r.monthlyRent >= Number(process.env.MIN_MONTHLY_RENT || 2000) &&
          r.monthlyRent <= Number(process.env.MAX_MONTHLY_RENT || 100000),
      )
    )
      issues.push("Monthly rent for " + type + " sharing");
  if (!listing.ownerAuthorized) issues.push("Owner publication authorization");
  if (
    !(listing.images || []).some(
      (image) => image.type === "Exterior" && image.rightsDeclared,
    )
  )
    issues.push(
      "A genuine building / exterior photo with publication permission",
    );
  if (
    !(listing.authorizationDocuments || []).some(
      (document) => document.declaration,
    )
  )
    issues.push("A PG operation authorization document for admin review");
  return issues;
}
module.exports = { parse, publishable, submissionIssues };
