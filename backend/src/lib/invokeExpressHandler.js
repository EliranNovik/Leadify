/**
 * Invoke an Express (req, res) handler and return { status, data }.
 */
function invokeExpressHandler(handler, { body = {}, params = {}, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = { body, params, query };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        if (!settled) {
          settled = true;
          resolve({ status: this.statusCode, data });
        }
        return this;
      },
    };

    Promise.resolve(handler(req, res)).catch((err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

module.exports = { invokeExpressHandler };
