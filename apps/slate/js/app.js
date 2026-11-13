/* Loom's page: the runs half (it owns the tab bar and the router) and the board half load side by side, so
   neither waits on the other's first read. loom.js is the seam between them. */
import('./dispatch/main.js');
import('./main.js');
