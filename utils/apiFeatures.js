// Chainable helper wrapping a Mongoose query with URL-query-string driven
// search, filtering, sorting, and pagination. Used by GET /products.
//
// Supported query params:
//   ?search=scarf                  -> full-text search (name/description/tags)
//   ?category=<id>                 -> exact match
//   ?price[gte]=200&price[lte]=800 -> range filter
//   ?isFeatured=true               -> exact match
//   ?sort=price,-createdAt         -> comma separated, "-" = descending
//   ?page=2&limit=12               -> pagination
class APIFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }

  search() {
    if (this.queryString.search) {
      this.query = this.query.find({ $text: { $search: this.queryString.search } });
    }
    return this;
  }

  filter() {
    const queryObj = { ...this.queryString };
    const excludedFields = ["page", "sort", "limit", "search", "fields"];
    excludedFields.forEach((field) => delete queryObj[field]);

    // Whitelist of fields that are allowed as filters.
    // Any field not in this list is silently dropped, which prevents
    // MongoDB operator injection (e.g. ?status[$ne]=...).
    const ALLOWED_FILTER_FIELDS = new Set([
      "category",
      "isFeatured",
      "isAvailable",
      "price",
      "tags",
      "status",
    ]);

    const safeQuery = {};
    for (const key of Object.keys(queryObj)) {
      if (ALLOWED_FILTER_FIELDS.has(key)) {
        safeQuery[key] = queryObj[key];
      }
    }

    // Convert { price: { gte: '200' } } style bracket notation into Mongo operators
    let queryStr = JSON.stringify(safeQuery);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`);
    const parsed = JSON.parse(queryStr);

    // Coerce numeric-looking range values to numbers
    if (parsed.price) {
      Object.keys(parsed.price).forEach((op) => {
        parsed.price[op] = Number(parsed.price[op]);
      });
    }
    if (parsed.isFeatured !== undefined) parsed.isFeatured = parsed.isFeatured === "true";
    if (parsed.isAvailable !== undefined) parsed.isAvailable = parsed.isAvailable === "true";

    this.query = this.query.find(parsed);
    return this;
  }

  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(",").join(" ");
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort("-createdAt");
    }
    return this;
  }

  paginate() {
    const page = Math.max(parseInt(this.queryString.page, 10) || 1, 1);
    const limit = Math.min(parseInt(this.queryString.limit, 10) || 12, 50);
    const skip = (page - 1) * limit;
    this.query = this.query.skip(skip).limit(limit);
    this.pagination = { page, limit };
    return this;
  }
}

export default APIFeatures;
