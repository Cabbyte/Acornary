if (location.pathname === '/inspect' || location.pathname.startsWith('/inspect/')) {
  void import('./inspector');
} else if (
  ['/login', '/consent', '/register', '/recover', '/join', '/choose-household'].includes(
    location.pathname,
  )
) {
  void import('./authentication');
} else {
  void import('./app');
}
