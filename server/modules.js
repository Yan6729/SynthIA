'use strict';
/* Liste des modules branchés sur l'application, dans l'ordre. */
module.exports = [
  require('./auth').mount,
  require('./me').mount,
];
