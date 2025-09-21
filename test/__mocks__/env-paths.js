module.exports = function envPaths(name) {
  return {
    data: `/tmp/${name}-test`,
    config: `/tmp/${name}-test-config`,
    cache: `/tmp/${name}-test-cache`,
    log: `/tmp/${name}-test-log`,
    temp: `/tmp/${name}-test-temp`
  };
};
