if (location.pathname === '/inspect' || location.pathname.startsWith('/inspect/')) {
  void import('./inspector');
} else if (location.pathname === '/login' || location.pathname === '/consent') {
  void import('./authentication');
} else {
  void import('./app');
}
