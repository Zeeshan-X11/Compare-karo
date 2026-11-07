const {problem}=require('./errors');
const mongoose = require("mongoose");
const { sharing } = require("./filters");
function phone(value) {
  let digits = String(value || "").replace(/[^0-9]/g, "");
  if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  if (
    !/^[6-9][0-9]{9}$/.test(digits) ||
    /(.)\1{5,}/.test(digits) ||
    ["9876543210", "9123456789", "9999999999", "1234567890"].includes(digits)
  )
    return null;
  return "+91" + digits;
}
function dateInput(value, label, { future = false } = {}) {
  if (!value) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw problem(400,label + " must be a valid date.");
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  if (!future && value > today)
    throw problem(400,label + " must not be in the future.");
  return new Date(value + "T00:00:00Z");
}
function moveIn(listing, selected) {
  const option = (listing.roomOptions || []).find(
    (r) => r.sharing === selected,
  );
  const rent = option ? option.monthlyRent : listing.monthlyRent;
  const values = [rent, listing.securityDeposit, listing.oneTimeFee];
  return {
    rent,
    deposit: listing.securityDeposit,
    fee: listing.oneTimeFee,
    total: values.every((v) => v != null)
      ? values.reduce((a, b) => a + b, 0)
      : null,
    knownTotal: values.filter((v) => v != null).reduce((a, b) => a + b, 0),
  };
}
const { maps } = require('./maps');
function page(value) {
  return Math.min(
    10000,
    Math.max(1, parseInt(typeof value === "string" ? value : "1", 10) || 1),
  );
}
function objectIds(values) {
  return [...new Set(values || [])]
    .filter((v) => mongoose.isValidObjectId(v))
    .slice(0, 100)
    .map((v) => new mongoose.Types.ObjectId(v));
}
function localVisit(value) {return value ? new Date(new Date(value).getTime()+19800000).toISOString().slice(0,16) : '';}
function scheduledVisit(raw) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) throw problem(400,'Enter a valid scheduled visit date and time in IST.');
  dateInput(raw.slice(0,10),'Visit date',{future:true});
  const value=new Date(raw+'+05:30');
  if(!Number.isFinite(value.getTime()) || localVisit(value)!==raw || value<Date.now() || value>Date.now()+90*86400000)throw problem(400,'Choose a valid future visit within 90 days.');
  return value;
}
module.exports = { phone, dateInput, moveIn, maps, page, objectIds, sharing, localVisit, scheduledVisit };
