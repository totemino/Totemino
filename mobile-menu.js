// Mobile menu functionality
(function() {
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const mobileSidebar = document.getElementById('mobile-sidebar');
  const mobileSidebarOverlay = document.getElementById('mobile-sidebar-overlay');
  const sidebarButtons = document.querySelectorAll('.sidebar-btn');
  
  // Apri/chiudi menu
  function toggleMenu() {
    mobileSidebar.classList.toggle('open');
    mobileSidebarOverlay.classList.toggle('show');
  }
  
  // Chiudi menu
  function closeMenu() {
    mobileSidebar.classList.remove('open');
    mobileSidebarOverlay.classList.remove('show');
  }
  
  // Event listener per hamburger button
  if (mobileMenuToggle) {
    mobileMenuToggle.addEventListener('click', toggleMenu);
  }
  
  // Event listener per overlay (chiudi al click fuori)
  if (mobileSidebarOverlay) {
    mobileSidebarOverlay.addEventListener('click', closeMenu);
  }
  
  // Event listener per ogni bottone della sidebar
  sidebarButtons.forEach(button => {
    button.addEventListener('click', function() {
      const action = this.getAttribute('data-action');
      
      // Chiudi il menu
      closeMenu();
      
      // Esegui l'azione corrispondente
      setTimeout(() => {
        switch(action) {
          case 'fullscreen':
            document.getElementById('fullscreen')?.click();
            break;
          case 'refresh':
            document.getElementById('table-refresh-btn')?.click();
            break;
          case 'profile':
            document.getElementById('back-btn')?.click();
            break;
          case 'theme':
            document.getElementById('theme')?.click();
            break;
        }
      }, 300); // Piccolo delay per permettere l'animazione di chiusura
    });
  });

})();

