const {problem}=require('./errors');
const { localities } = require("./localities");
const amenities = [
  "Wi-Fi",
  "Parking",
  "Laundry",
  "Attached bathroom",
  "Furnished",
  "Power backup",
  "Housekeeping",
  "Drinking water",
  "Security",
];
const sharing = ["Single", "Double", "Triple", "Four+"];
function scalar(v) {
  return typeof v === "string" ? v.trim() : "";
}
function filters(q) {
  const query = { listingStatus: "published", locality: "Rajanukunte" };
  const area = scalar(q.area);
  if (area && !localities.includes(area)) query.locality = { $in: [] };
  const rent = {};
  for (const [key, op] of [
    ["minRent", "$gte"],
    ["maxRent", "$lte"],
  ]) {
    const v = scalar(q[key]);
    if (v) {
      if (!/^\d{1,7}$/.test(v)) throw problem(400,"Enter a valid rent amount.");
      rent[op] = Number(v);
    }
  }
  if (Object.keys(rent).length) {
    if (rent.$gte > rent.$lte)
      throw problem(400,"Minimum rent must not exceed maximum rent.");
    query.monthlyRent = rent;
  }
  if (sharing.includes(scalar(q.sharing)))
    query.sharingOptions = scalar(q.sharing);
  if (query.sharingOptions && query.monthlyRent) {
    query.$or = [
      {
        roomOptions: {
          $elemMatch: { sharing: query.sharingOptions, monthlyRent: rent },
        },
      },
      {
        $and: [
          {
            roomOptions: {
              $not: { $elemMatch: { sharing: query.sharingOptions } },
            },
          },
          { monthlyRent: rent },
        ],
      },
    ];
    delete query.monthlyRent;
  }
  if (["Men", "Women", "Co-living"].includes(scalar(q.category)))
    query.propertyCategory = scalar(q.category);
  const selected = (Array.isArray(q.amenity) ? q.amenity : [q.amenity]).filter(
    (x) => amenities.includes(x),
  );
  if (selected.length) query.amenities = { $all: selected };
  if (q.foodIncluded === "yes") query.foodIncluded = true;
  if (q.food === "yes")
    query.foodOptions = { $in: ["Breakfast", "Lunch", "Dinner"] };
  const page = Math.min(10000, Math.max(1, parseInt(scalar(q.page), 10) || 1));
  const sort =
    q.sort === "rent-asc"
      ? { monthlyRent: 1, _id: 1 }
      : q.sort === "rent-desc"
        ? { monthlyRent: -1, _id: 1 }
        : { createdAt: -1, _id: -1 };
  return { query, page, sort };
}
module.exports = { filters, amenities, sharing, scalar };
