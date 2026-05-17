document.addEventListener('DOMContentLoaded', () => {
    // Detect base path from Jekyll's baseurl (injected via meta tag in layout)
    const baseEl = document.querySelector('meta[name="baseurl"]');
    const base = baseEl ? baseEl.content : '';

    // Determine active tab
    const path = window.location.pathname;
    const isBlog = path.includes('/blog');
    const isAbout = path.includes('/about');
    const isRank = path.includes('/rank-yourself');
    const isHome = !isBlog && !isAbout && !isRank;

    // Inject Sidebar HTML
    const sidebarHTML = `
    <aside class="sidebar">
        <div class="profile-section">
            <img class="profile-img" src="${base}/assets/images/portrait.png" alt="LL Cool M">
            <h1>LL Cool M</h1>
            <h2>Engineer | AI Infra</h2>
        </div>
        
        <nav class="main-nav">
            <a href="${base}/" class="${isHome ? 'active' : ''}">Home</a>
            <a href="${base}/blog/" class="${isBlog ? 'active' : ''}">Blog</a>
            <a href="${base}/about/" class="${isAbout ? 'active' : ''}">About</a>
            <a href="${base}/rank-yourself/" class="${isRank ? 'active' : ''}">Rank Yourself</a>
        </nav>

        <div class="theme-toggle" id="theme-toggle">
            <i class="fa ${document.documentElement.getAttribute('data-theme') === 'dark' ? 'fa-sun-o' : 'fa-moon-o'}" id="theme-icon"></i>
            <span id="theme-text">${document.documentElement.getAttribute('data-theme') === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </div>
    </aside>
    `;

    document.body.insertAdjacentHTML('afterbegin', sidebarHTML);

    // Initialize Theme Toggle Logic
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const themeText = document.getElementById('theme-text');

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateToggleUI(newTheme);
        });
    }

    function updateToggleUI(theme) {
        if (!themeIcon || !themeText) return;

        if (theme === 'dark') {
            themeIcon.className = 'fa fa-sun-o'; // Switch icon to sun
            themeText.textContent = 'Light Mode';
        } else {
            themeIcon.className = 'fa fa-moon-o'; // Switch icon to moon
            themeText.textContent = 'Dark Mode';
        }
    }
});
