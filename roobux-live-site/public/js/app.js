/* ==========================================
   ROOBUX - Main Application Logic (V2 - GOD MODE)
   - Handles all V2 features
   - Maintenance Mode, Banning, Referrals
   - User tracking (IP/Country)
   - Dynamic Content Loading
   - Live Support Chat
   - FIX: Removes duplicate Firestore initialization
   ========================================== */

// ==========================================
// 1. SITE-WIDE INITIALIZATION
// ==========================================

/**
 * Main entry point for the application.
 * This runs on every single page load.
 */
async function initializeSite() {
    // 1. Check Maintenance Mode
    // This runs before anything else.
    try {
        const maintenanceDoc = await db.collection('site_status').doc('main').get();
        if (maintenanceDoc.exists && maintenanceDoc.data().isMaintenance) {
            
            // Check if user is admin *before* redirecting
            const user = await new Promise((resolve) => {
                const unsubscribe = auth.onAuthStateChanged((user) => {
                    unsubscribe();
                    resolve(user);
                });
            });

            let isAdmin = false;
            if (user) {
                // Force-refresh the token to get the latest claims
                const idTokenResult = await user.getIdTokenResult(true); 
                isAdmin = idTokenResult.claims.admin === true;
            }

            // If site is in maintenance AND user is not admin AND we are not on the maintenance page, redirect.
            if (!isAdmin && window.location.pathname.includes('/maintenance.html') === false) {
                console.warn("Site is in Maintenance Mode. Redirecting...");
                window.location.href = 'maintenance.html';
                return; // Stop loading the rest of the site
            } else if (isAdmin) {
                 console.warn("Site is in Maintenance Mode, but you are an Admin. Access granted.");
            }
        }
    } catch (error) {
        console.error("Error checking maintenance mode:", error);
        // If this fails, we let the site load normally.
    }

    // 2. Load dynamic theme & content from "God Mode" admin panel
    loadDynamicTheme();
    loadDynamicContent();

    // 3. Attach all page-specific listeners
    onPageLoad();
}

/**
 * Loads dynamic theme colors from Firestore and applies them.
 */
async function loadDynamicTheme() {
    try {
        const themeDoc = await db.collection('site_content').doc('theme').get();
        if (themeDoc.exists) {
            const theme = themeDoc.data();
            const root = document.documentElement;
            
            root.style.setProperty('--primary-color', theme.primary_color || '#007BFF');
            root.style.setProperty('--secondary-color', theme.secondary_color || '#8B5CF6');
            
            const hex = theme.primary_color || '#007BFF';
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            root.style.setProperty('--primary-glow', `rgba(${r}, ${g}, ${b}, 0.4)`);
        }
    } catch (error) {
        console.error("Error loading dynamic theme:", error);
    }
}

/**
 * Loads dynamic text content from Firestore and populates the page.
 */
async function loadDynamicContent() {
    try {
        const contentDoc = await db.collection('site_content').doc('main').get();
        if (contentDoc.exists) {
            const content = contentDoc.data();
            
            // Populate elements if they exist on the current page
            // Homepage
            const heroTitle = document.getElementById('content-hero-title');
            if (heroTitle && content.hero_title) {
                heroTitle.textContent = content.hero_title;
            }
            const heroSubtitle = document.getElementById('content-hero-subtitle');
            if (heroSubtitle && content.hero_subtitle) {
                heroSubtitle.textContent = content.hero_subtitle;
            }

            // About Page
            const aboutStory = document.getElementById('content-about-story');
            if (aboutStory && content.about_story) {
                // Use .innerHTML to allow simple line breaks
                aboutStory.innerHTML = content.about_story.replace(/\n/g, '<br>');
            }
        }
    } catch (error) {
        console.error("Error loading dynamic content:", error);
    }
}

// ==========================================
// 2. GLOBAL STATE & UTILITIES
// ==========================================

let currentUser = null;
let userBalance = 0;
let userUnsubscribe = null; // To stop listening to user doc
let chatUnsubscribe = null; // To stop listening to chat

function formatCurrency(amount) {
    if (typeof amount !== 'number') { amount = 0; }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(amount);
}

function formatDate(timestamp) {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function showLoading(buttonId, show = true) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    const textSpan = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    if (show) {
        if (textSpan) textSpan.style.display = 'none';
        if (loader) loader.style.display = 'block';
        btn.disabled = true;
    } else {
        if (textSpan) textSpan.style.display = 'inline';
        if (loader) loader.style.display = 'none';
        btn.disabled = false;
    }
}

function showError(elementId, message) {
    const errorEl = document.getElementById(elementId);
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        const successEl = errorEl.id.replace('error', 'success');
        if (successEl && document.getElementById(successEl)) {
            document.getElementById(successEl).style.display = 'none';
        }
    }
}

function showSuccess(elementId, message) {
    const successEl = document.getElementById(elementId);
    if (successEl) {
        successEl.textContent = message;
        successEl.style.display = 'block';
        const errorEl = successEl.id.replace('success', 'error');
        if (errorEl && document.getElementById(errorEl)) {
            document.getElementById(errorEl).style.display = 'none';
        }
    }
}

/**
 * Gets the referral code from the URL (e.g., ?ref=USERID)
 */
function getRefCodeFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('ref');
}

/**
 * Gets the user's IP and Country for "God Mode" tracking.
 * Uses a free, no-key-required API.
 */
async function getUserInfo() {
    try {
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) return null;
        const data = await response.json();
        return {
            ip: data.ip || 'N/A',
            country: data.country_name || 'N/A'
        };
    } catch (error) {
        console.error("Error fetching user info:", error);
        return { ip: 'Error', country: 'Error' };
    }
}

// ==========================================
// 3. AUTHENTICATION & USER SETUP
// ==========================================

// Auth state observer
auth.onAuthStateChanged(async (user) => {
    // Stop any previous listeners
    if (userUnsubscribe) userUnsubscribe();
    if (chatUnsubscribe) chatUnsubscribe();
    
    if (user) {
        if (user.emailVerified) {
            currentUser = user;
            await setupUser(user);
        } else {
            currentUser = null;
            const protectedPages = ['dashboard.html', 'deposit.html', 'withdraw.html', 'profile.html', 'referrals.html', 'support.html'];
            const currentPage = window.location.pathname.split('/').pop();
            if (protectedPages.includes(currentPage)) {
                window.location.href = 'index.html';
            }
            showError('login-error', 'Please verify your email before logging in. Check your inbox.');
        }
    } else {
        currentUser = null;
    }
    updateNavigation(currentUser);
    checkPageAccess();
});

// Setup user document, check for ban, and update info
async function setupUser(user) {
    const userDocRef = db.collection('users').doc(user.uid);
    
    // Set up a real-time listener for the user's document
    userUnsubscribe = userDocRef.onSnapshot(async (doc) => {
        if (doc.exists) {
            const userData = doc.data();
            
            // --- BAN CHECK ---
            if (userData.isBanned === true) {
                await auth.signOut();
                window.location.href = 'blocked.html';
                return;
            }

            userBalance = userData.balance || 0;
            
            // Update balance on all pages that show it
            const balanceEl = document.getElementById('dashboard-balance') || document.getElementById('withdraw-balance') || document.getElementById('profile-balance');
            if (balanceEl) balanceEl.textContent = formatCurrency(userBalance);
            
            // If this is the first time we're seeing this user (user_info is null),
            // fetch their IP/Country and update it.
            if (!userData.user_info) {
                const userInfo = await getUserInfo();
                userDocRef.update({
                    last_login: firebase.firestore.FieldValue.serverTimestamp(),
                    user_info: userInfo
                });
            } else {
                 // Otherwise, just update last_login
                 userDocRef.update({
                    last_login: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

        } else {
            // Create new user document
            const userInfo = await getUserInfo();
            const refCode = getRefCodeFromURL(); // Get ref code from URL
            const settingsDoc = await db.collection('site_content').doc('referrals').get();
            const newUserBonus = (settingsDoc.exists && settingsDoc.data().newUserBonus) ? settingsDoc.data().newUserBonus : 0;
            
            await userDocRef.set({
                email: user.email,
                balance: (refCode ? newUserBonus : 0), // Only give bonus if referred
                created_at: firebase.firestore.FieldValue.serverTimestamp(),
                last_login: firebase.firestore.FieldValue.serverTimestamp(),
                isBanned: false,
                referred_by: refCode || null, // Store who referred them
                user_info: userInfo
            });
            
            if (newUserBonus > 0 && refCode) {
                console.log(`Awarded ${formatCurrency(newUserBonus)} new user bonus.`);
            }
        }
    }, (error) => {
        console.error("Error listening to user document:", error);
    });
}

// Update navigation based on auth state
function updateNavigation(user) {
    const loginBtn = document.getElementById('login-trigger');
    const userMenu = document.getElementById('user-menu');
    const userEmailNav = document.getElementById('user-email-nav');
    
    if (user) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (userMenu) userMenu.style.display = 'block';
        if (userEmailNav) userEmailNav.textContent = user.email.split('@')[0];
    } else {
        if (loginBtn) loginBtn.style.display = 'inline-flex';
        if (userMenu) userMenu.style.display = 'none';
    }
}

// Check page access
function checkPageAccess() {
    const protectedPages = ['dashboard.html', 'deposit.html', 'withdraw.html', 'profile.html', 'referrals.html', 'support.html'];
    const currentPage = window.location.pathname.split('/').pop();
    
    if (protectedPages.includes(currentPage) && !currentUser) {
        console.log('Access denied, redirecting to index.');
        window.location.href = 'index.html';
    }
}

// Login function
async function handleLogin(email, password) {
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        
        if (!userCredential.user.emailVerified) {
            await auth.signOut();
            return { success: false, message: 'Please verify your email first. Check your inbox.' };
        }
        
        window.location.href = 'dashboard.html';
        return { success: true };
    } catch (error) {
        let message = 'Login failed. Please try again.';
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            message = 'Invalid email or password.';
        }
        return { success: false, message };
    }
}

// Signup function
async function handleSignup(email, password) {
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await userCredential.user.sendEmailVerification();
        
        // We will create the user doc in setupUser() on the first *verified* login.
        // This is more secure and handles the ref bonus logic correctly.
        
        await auth.signOut();
        
        return { 
            success: true, 
            message: 'Account created! Please check your email to verify your account before logging in.' 
        };
    } catch (error) {
        let message = 'Signup failed. Please try again.';
        if (error.code === 'auth/email-already-in-use') message = 'Email already registered.';
        if (error.code === 'auth/weak-password') message = 'Password should be at least 6 characters.';
        return { success: false, message };
    }
}

// Password Reset function
async function handlePasswordReset(email) {
    try {
        await auth.sendPasswordResetEmail(email);
        return { success: true, message: 'Password reset link sent! Check your email.' };
    } catch (error) {
        let message = 'Failed to send reset email.';
        if (error.code === 'auth/user-not-found') message = 'No account found with this email.';
        return { success: false, message };
    }
}

// Logout function
async function handleLogout() {
    try {
        await auth.signOut();
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// ==========================================
// 4. MODAL CONTROLS
// ==========================================
function attachModalListeners() {
    const authModalOverlay = document.getElementById('auth-modal-overlay');
    const authCard = document.getElementById('auth-card');
    const loginTriggers = document.querySelectorAll('#login-trigger, #hero-get-started, #cta-signup, #login-trigger-footer');
    const authModalClose = document.getElementById('auth-modal-close');
    const showSignupBtn = document.getElementById('show-signup');
    const showLoginBtn = document.getElementById('show-login');
    const showForgotPasswordBtn = document.getElementById('show-forgot-password');
    const showLoginFromResetBtn = document.getElementById('show-login-from-reset');

    loginTriggers.forEach(trigger => {
        if (trigger) {
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                if (currentUser) {
                    window.location.href = 'dashboard.html';
                } else {
                    if (authModalOverlay) authModalOverlay.classList.add('active');
                    if (authCard) authCard.classList.remove('flipped', 'show-reset');
                }
            });
        }
    });

    if (authModalClose) {
        authModalClose.addEventListener('click', () => {
            if (authModalOverlay) authModalOverlay.classList.remove('active');
        });
    }
    if (authModalOverlay) {
        authModalOverlay.addEventListener('click', (e) => {
            if (e.target === authModalOverlay) {
                authModalOverlay.classList.remove('active');
            }
        });
    }

    if (showSignupBtn) {
        showSignupBtn.addEventListener('click', () => {
            if (authCard) authCard.classList.add('flipped');
            if (authCard) authCard.classList.remove('show-reset');
        });
    }
    if (showLoginBtn) {
        showLoginBtn.addEventListener('click', () => {
            if (authCard) authCard.classList.remove('flipped');
            if (authCard) authCard.classList.remove('show-reset');
        });
    }
    if (showForgotPasswordBtn) {
        showForgotPasswordBtn.addEventListener('click', () => {
            if (authCard) authCard.classList.add('show-reset');
            if (authCard) authCard.classList.remove('flipped');
        });
    }
    if (showLoginFromResetBtn) {
        showLoginFromResetBtn.addEventListener('click', () => {
            if (authCard) authCard.classList.remove('show-reset');
            if (authCard) authCard.classList.remove('flipped');
        });
    }
}

// ==========================================
// 5. FORM HANDLERS
// ==========================================
function attachFormListeners() {
    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoading('login-submit-btn');
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const result = await handleLogin(email, password);
            if (!result.success) {
                showError('login-error', result.message);
                showLoading('login-submit-btn', false);
            }
        });
    }

    // Signup form
    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoading('signup-submit-btn');
            const email = document.getElementById('signup-email').value;
            const password = document.getElementById('signup-password').value;
            const confirmPassword = document.getElementById('signup-password-confirm').value;
            if (password !== confirmPassword) {
                showError('signup-error', 'Passwords do not match');
                showLoading('signup-submit-btn', false);
                return;
            }
            const result = await handleSignup(email, password);
            if (result.success) {
                showSuccess('login-error', result.message); // Show success on LOGIN form
                const authCard = document.getElementById('auth-card');
                if (authCard) authCard.classList.remove('flipped');
            } else {
                showError('signup-error', result.message);
            }
            showLoading('signup-submit-btn', false);
        });
    }

    // Reset Password form
    const resetForm = document.getElementById('reset-form');
    if (resetForm) {
        resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoading('reset-submit-btn');
            const email = document.getElementById('reset-email').value;
            const result = await handlePasswordReset(email);
            if (result.success) {
                showSuccess('reset-success', result.message);
            } else {
                showError('reset-error', result.message);
            }
            showLoading('reset-submit-btn', false);
        });
    }

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogout();
        });
    }
}

// ==========================================
// 6. MOBILE NAVIGATION
// ==========================================
function attachNavListeners() {
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const navMenu = document.getElementById('nav-menu');

    if (mobileMenuToggle && navMenu) {
        mobileMenuToggle.addEventListener('click', () => {
            navMenu.classList.toggle('open');
        });
    }

    // User menu dropdown
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userDropdown = document.getElementById('user-dropdown');

    if (userMenuBtn && userDropdown) {
        userMenuBtn.addEventListener('click', () => {
            userDropdown.style.display = userDropdown.style.display === 'flex' ? 'none' : 'flex';
        });
        document.addEventListener('click', (e) => {
            if (userMenuBtn && userDropdown && !userMenuBtn.contains(e.target) && !userDropdown.contains(e.target)) {
                userDropdown.style.display = 'none';
            }
        });
    }
}

// ==========================================
// 7. LOAD PACKAGES
// ==========================================

function loadPackages(containerId = 'packages-grid', limit = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // --- THIS IS THE FIX ---
    // The query must match the index *exactly*.
    // We sort by 'min_deposit' (Ascending) and filter by 'visible' == true.
    let query = db.collection('packages')
                  .where('visible', '==', true)
                  .orderBy('min_deposit'); // This now requires the composite index
    
    if (limit) query = query.limit(limit);
    
    query.onSnapshot((snapshot) => {
        if (snapshot.empty) {
            container.innerHTML = '<p class="empty-state">No packages available at the moment. Please check back later.</p>';
            return;
        }
        
        container.innerHTML = '';
        snapshot.forEach((doc) => {
            const pkg = doc.data();
            const card = createPackageCard(pkg, doc.id);
            container.appendChild(card);
        });
        
        populatePackageDropdowns(snapshot);
    }, error => {
        console.error("Error loading packages: ", error);
        // This is the error you are seeing. It's an indexing error.
        container.innerHTML = `<p class="empty-state" style="color: var(--error);">Could not load packages. A database index is required. Please check the browser console (F12) for a link to create the index.</p>`;
    });
}

function createPackageCard(pkg, id) {
    const card = document.createElement('div');
    card.className = 'package-card';
    
    const totalReturn = (pkg.daily_return_percent / 100) * pkg.duration_days * 100;
    
    card.innerHTML = `
        <div class="package-header">
            <div class="package-icon">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="2"/>
                    <text x="32" y="40" text-anchor="middle" font-size="24" fill="currentColor">$</text>
                </svg>
            </div>
            <h3 class="package-title">${pkg.title}</h3>
            <p>${pkg.description || ''}</p>
        </div>
        <div class="package-body">
            <div class="package-price">${pkg.daily_return_percent}%</div>
            <p>Daily Return</p>
            <ul class="package-features">
                <li>Min: ${formatCurrency(pkg.min_deposit)}</li>
                <li>Max: ${formatCurrency(pkg.max_deposit)}</li>
                <li>Duration: ${pkg.duration_days} days</li>
                <li>Total Return: ${totalReturn.toFixed(0)}%</li>
            </ul>
        </div>
        <button class="btn btn-primary btn-block" data-package-id="${id}">Invest Now</button>
    `;
    
    // Attach event listener AFTER creating the button
    const investButton = card.querySelector('button[data-package-id]');
    if (investButton) {
        investButton.addEventListener('click', () => {
            openDepositModal(id);
        });
    }
    
    return card;
}

function openDepositModal(packageId) {
    if (currentUser) {
        // Pass the package ID in the URL so deposit.html can pre-select it
        window.location.href = `deposit.html?package=${packageId}`;
    } else {
        const authModalOverlay = document.getElementById('auth-modal-overlay');
        if (authModalOverlay) authModalOverlay.classList.add('active');
    }
}

// Populate package dropdowns
function populatePackageDropdowns(snapshot) {
    const dropdowns = ['calc-package', 'calc-package-packages', 'deposit-package'];
    
    dropdowns.forEach(dropdownId => {
        const select = document.getElementById(dropdownId);
        if (!select) return;
        
        select.innerHTML = '<option value="">Choose a package...</option>';
        snapshot.forEach((doc) => {
            const pkg = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = `${pkg.title} (${pkg.daily_return_percent}% daily)`;
            option.dataset.dailyPercent = pkg.daily_return_percent;
            option.dataset.duration = pkg.duration_days;
            option.dataset.min = pkg.min_deposit;
            option.dataset.max = pkg.max_deposit;
            select.appendChild(option);
        });
        
        // Check if URL has a pre-selected package
        const urlParams = new URLSearchParams(window.location.search);
        const packageId = urlParams.get('package');
        if (packageId && dropdownId === 'deposit-package') {
            select.value = packageId;
        }
    });
}

// ==========================================
// 8. LOAD TESTIMONIALS & STATS
// ==========================================

function loadTestimonials(containerId = 'testimonials-grid', limit = 6) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Set a placeholder with your requested stats
    const statsContainer = document.getElementById('stats-counter-grid');
    if (statsContainer) {
        statsContainer.innerHTML = `
            <div class="stat-card">
                <div class="stat-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
                <div class="stat-number">6,000+</div>
                <div class="stat-label">Active Investors</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
                <div class="stat-number">$400,000+</div>
                <div class="stat-label">Total Invested</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12V7H5a2 2 0 010-4h14a2 2 0 012 2v4zM3 5v14a2 2 0 002 2h16a2 2 0 002-2v-4H3z"/></svg></div>
                <div class="stat-number">99.9%</div>
                <div class="stat-label">Uptime Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg></div>
                <div class="stat-number">24/7</div>
                <div class="stat-label">Support</div>
            </div>
        `;
    }
    
    db.collection('testimonials').where('visible', '==', true).limit(limit)
        .onSnapshot((snapshot) => {
            if (snapshot.empty) {
                container.innerHTML = '<p class="empty-state">No testimonials yet.</p>';
                return;
            }
            container.innerHTML = '';
            snapshot.forEach((doc) => {
                const testimonial = doc.data();
                container.appendChild(createTestimonialCard(testimonial));
            });
        }, error => console.error("Error loading testimonials: ", error));
}

function createTestimonialCard(testimonial) {
    const card = document.createElement('div');
    card.className = 'testimonial-card';
    const stars = '★'.repeat(testimonial.rating) + '☆'.repeat(5 - testimonial.rating);
    card.innerHTML = `
        <div class="testimonial-header">
            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(testimonial.name)}&background=3B82F6&color=fff" 
                 alt="${testimonial.name}" class="testimonial-avatar">
            <div>
                <h4>${testimonial.name}</h4>
                <p>${testimonial.country}</p>
                <div class="testimonial-rating">${stars}</div>
            </div>
        </div>
        <p class="testimonial-text">"${testimonial.text}"</p>
    `;
    return card;
}

// ==========================================
// 9. ROI CALCULATOR
// ==========================================

function setupROICalculator(calcBtnId, amountId, packageId, resultsId, dailyId, totalId, durationId, profitId = null) {
    const calcBtn = document.getElementById(calcBtnId);
    if (!calcBtn) return;
    
    calcBtn.addEventListener('click', () => {
        const amountEl = document.getElementById(amountId);
        const packageSelect = document.getElementById(packageId);
        if (!amountEl || !packageSelect) return;
        
        const amount = parseFloat(amountEl.value);
        const selectedOption = packageSelect.options[packageSelect.selectedIndex];
        
        if (!amount || amount < 100) {
            alert('Please enter a valid amount (minimum $100)');
            return;
        }
        if (!selectedOption || !selectedOption.value) {
            alert('Please select a package');
            return;
        }
        
        const dailyPercent = parseFloat(selectedOption.dataset.dailyPercent);
        const duration = parseInt(selectedOption.dataset.duration);
        const dailyReturn = (amount * dailyPercent) / 100;
        const totalReturn = dailyReturn * duration;
        const profit = totalReturn; // In this model, profit is total return
        
        document.getElementById(dailyId).textContent = formatCurrency(dailyReturn);
        document.getElementById(totalId).textContent = formatCurrency(totalReturn);
        document.getElementById(durationId).textContent = `${duration} days`;
        if (profitId) {
            document.getElementById(profitId).textContent = formatCurrency(profit);
        }
        document.getElementById(resultsId).style.display = 'block';
    });
}

// ==========================================
// 10. LIVE PRICE TICKERS
// ==========================================

async function updateCryptoPrices() {
    const ids = 'bitcoin,ethereum,litecoin';
    const vs = 'usd';
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}&include_24hr_change=true`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch prices');
        const data = await response.json();
        
        // Homepage Ticker
        const btcPriceEl = document.getElementById('btc-price');
        const btcChangeEl = document.getElementById('btc-change');
        if (btcPriceEl && data.bitcoin) {
            const price = data.bitcoin.usd;
            const change = data.bitcoin.usd_24h_change;
            btcPriceEl.textContent = formatCurrency(price);
            if (btcChangeEl) {
                btcChangeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
                btcChangeEl.style.color = change >= 0 ? 'var(--success)' : 'var(--error)';
            }
        }
        
        // Dashboard Tickers
        const dashBtc = document.getElementById('dash-btc-price');
        const dashEth = document.getElementById('dash-eth-price');
        const dashLtc = document.getElementById('dash-ltc-price');
        
        if (dashBtc && data.bitcoin) dashBtc.textContent = formatCurrency(data.bitcoin.usd);
        if (dashEth && data.ethereum) dashEth.textContent = formatCurrency(data.ethereum.usd);
        if (dashLtc && data.litecoin) dashLtc.textContent = formatCurrency(data.litecoin.usd);
        
    } catch (error) {
        console.error('Crypto price fetch error:', error);
        if (document.getElementById('btc-price')) document.getElementById('btc-price').textContent = 'Error';
    }
}

// ==========================================
// 11. FAQ ACCORDION
// ==========================================
function attachFAQListeners() {
    const faqContainer = document.querySelector('.faq-container');
    if (!faqContainer) return;
    
    faqContainer.addEventListener('click', (e) => {
        const questionBtn = e.target.closest('.faq-question');
        if (!questionBtn) return;
        
        const faqItem = questionBtn.parentElement;
        const isActive = faqItem.classList.contains('active');
        
        // Close all other items
        faqContainer.querySelectorAll('.faq-item').forEach(item => {
            if (item !== faqItem) item.classList.remove('active');
        });
        
        // Toggle the clicked item
        faqItem.classList.toggle('active', !isActive);
    });
}

// ==========================================
// 12. TERMS PAGE NAVIGATION
// ==========================================
function attachTermsListeners() {
    const termsNav = document.querySelector('.terms-nav');
    if (!termsNav) return;
    
    termsNav.addEventListener('click', (e) => {
        if (e.target.classList.contains('terms-nav-link')) {
            e.preventDefault();
            const section = e.target.dataset.section;
            
            termsNav.querySelectorAll('.terms-nav-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.terms-section-content').forEach(s => s.classList.remove('active'));
            
            e.target.classList.add('active');
            const el = document.getElementById(section);
            if (el) el.classList.add('active');
        }
    });
}

// ==========================================
// 13. LOAD SITE CONTENT (Partial)
// ==========================================

async function loadSiteFooterContent() {
    try {
        const doc = await db.collection('site_content').doc('main').get();
        if (doc.exists) {
            const content = doc.data();
            
            // Populate elements if they exist
            const safeSet = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            safeSet('footer-email', `Email: ${content.contact_email || 'support@roobux.site'}`);
            safeSet('footer-phone', `Phone: ${content.contact_phone || '+1 (555) 123-4567'}`);
            safeSet('contact-email-display', content.contact_email || 'support@roobux.site');
            safeSet('contact-phone-display', content.contact_phone || '+1 (555) 123-4567');
        }
    } catch (error) {
        console.error('Error loading site footer content:', error);
    }
}

// ==========================================
// 14. INITIALIZE PAGE-SPECIFIC FUNCTIONS
// ==========================================

function onPageLoad() {
    // Attach listeners that are on every page
    attachModalListeners();
    attachFormListeners();
    attachNavListeners();

    // Load content for all pages
    loadSiteFooterContent();
    updateCryptoPrices();
    setInterval(updateCryptoPrices, 60000); // Re-fetch every 60 seconds

    // Setup ROI calculators
    setupROICalculator('calc-btn', 'calc-amount', 'calc-package', 'roi-results', 'roi-daily', 'roi-total', 'roi-duration', 'roi-profit');
    setupROICalculator('calc-btn-packages', 'calc-amount-packages', 'calc-package-packages', 'roi-results-packages', 'roi-daily-packages', 'roi-total-packages', 'roi-duration-packages', 'roi-profit-packages');

    // Page-specific loads
    const page = window.location.pathname.split('/').pop() || 'index.html';
    
    switch(page) {
        case 'index.html':
            loadPackages('packages-grid', 3);
            loadTestimonials('testimonials-grid', 3);
            break;
        case 'packages.html':
            loadPackages('packages-grid-detail');
            loadComparisonTable();
            break;
        case 'how-it-works.html':
            attachFAQListeners();
            break;
        case 'contact.html':
            setupContactForm();
            break;
        case 'terms.html':
            attachTermsListeners();
            break;
        case 'dashboard.html':
            if (currentUser) loadDashboard();
            break;
        case 'deposit.html':
            if (currentUser) setupDepositPage();
            break;
        case 'withdraw.html':
            if (currentUser) setupWithdrawPage();
            break;
        case 'profile.html':
            if (currentUser) loadProfilePage();
            break;
        case 'referrals.html':
            if (currentUser) loadReferralPage();
            break;
        case 'support.html':
            if (currentUser) loadSupportChatPage();
            break;
    }
}

// Helper for comparison table
function loadComparisonTable() {
    const table = document.getElementById('comparison-table');
    if (!table) return;
    
    db.collection('packages').where('visible', '==', true).orderBy('min_deposit').limit(4).get()
        .then(snapshot => {
            snapshot.forEach((doc, index) => {
                const pkg = doc.data();
                const safeGet = (id) => document.getElementById(id) || {};
                
                safeGet(`comp-min-${index}`).textContent = formatCurrency(pkg.min_deposit);
                safeGet(`comp-max-${index}`).textContent = formatCurrency(pkg.max_deposit);
                safeGet(`comp-daily-${index}`).textContent = `${pkg.daily_return_percent}%`;
                safeGet(`comp-duration-${index}`).textContent = `${pkg.duration_days} days`;
                const totalReturn = (pkg.daily_return_percent / 100) * pkg.duration_days * 100;
                safeGet(`comp-total-${index}`).textContent = `${totalReturn.toFixed(0)}%`;
            });
        });
}

// Helper for contact form
function setupContactForm() {
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoading('contact-submit-btn');
            
            const name = document.getElementById('contact-name').value;
            const email = document.getElementById('contact-email-input').value;
            const subject = document.getElementById('contact-subject').value;
            const message = document.getElementById('contact-message').value;
            
            try {
                await db.collection('messages').add({
                    name, email, subject, message,
                    created_at: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'new'
                });
                showSuccess('contact-success', 'Message sent! We\'ll get back to you soon.');
                contactForm.reset();
            } catch (error) {
                showError('contact-error', 'Failed to send message. Please try again.');
            }
            showLoading('contact-submit-btn', false);
        });
    }
}

// ==========================================
// 15. DASHBOARD PAGE
// ==========================================

async function loadDashboard() {
    const userNameDisplay = document.getElementById('user-name-display');
    if (userNameDisplay && currentUser) {
        userNameDisplay.textContent = currentUser.email.split('@')[0];
    }
    
    // Balance is already being updated by the real-time listener in setupUser()
    
    loadDashboardStats();
    loadUserDeposits();
    loadUserWithdrawals();
}

async function loadDashboardStats() {
    if (!currentUser) return;
    
    try {
        const depositsSnapshot = await db.collection('deposits')
            .where('user_id', '==', currentUser.uid)
            .where('status', '==', 'approved')
            .get();
        
        let totalInvested = 0;
        depositsSnapshot.forEach(doc => { totalInvested += doc.data().amount || 0; });
        
        const withdrawalsSnapshot = await db.collection('withdrawals')
            .where('user_id', '==', currentUser.uid)
            .where('status', '==', 'approved')
            .get();
        
        let totalWithdrawn = 0;
        withdrawalsSnapshot.forEach(doc => { totalWithdrawn += doc.data().amount || 0; });
        
        // We use userBalance (from the real-time listener) for accuracy
        const totalEarnings = userBalance + totalWithdrawn; // Simplified: Total earned = current balance + total withdrawn
        
        document.getElementById('dashboard-invested').textContent = formatCurrency(totalInvested);
        document.getElementById('dashboard-withdrawn').textContent = formatCurrency(totalWithdrawn);
        document.getElementById('dashboard-earnings').textContent = formatCurrency(totalEarnings);
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

function loadUserDeposits() {
    if (!currentUser) return;
    const tbody = document.getElementById('deposits-tbody');
    if (!tbody) return;
    
    db.collection('deposits')
        .where('user_id', '==', currentUser.uid)
        .orderBy('created_at', 'desc')
        .limit(5)
        .onSnapshot((snapshot) => {
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No deposits yet</td></tr>';
                return;
            }
            tbody.innerHTML = '';
            snapshot.forEach((doc) => {
                const deposit = doc.data();
                const row = tbody.insertRow();
                row.innerHTML = `
                    <td>${formatDate(deposit.created_at)}</td>
                    <td>${formatCurrency(deposit.amount)}</td>
                    <td><span class="status-badge status-${deposit.status}">${deposit.status}</span></td>
                    <td>${deposit.tx_hash ? deposit.tx_hash.substring(0, 10) + '...' : 'N/A'}</td>
                `;
            });
        });
}

function loadUserWithdrawals() {
    if (!currentUser) return;
    const tbody = document.getElementById('withdrawals-tbody');
    if (!tbody) return;
    
    db.collection('withdrawals')
        .where('user_id', '==', currentUser.uid)
        .orderBy('created_at', 'desc')
        .limit(5)
        .onSnapshot((snapshot) => {
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No withdrawals yet</td></tr>';
                return;
            }
            tbody.innerHTML = '';
            snapshot.forEach((doc) => {
                const withdrawal = doc.data();
                const row = tbody.insertRow();
                row.innerHTML = `
                    <td>${formatDate(withdrawal.created_at)}</td>
                    <td>${formatCurrency(withdrawal.amount)}</td>
                    <td>${withdrawal.address ? withdrawal.address.substring(0, 15) + '...' : 'N/A'}</td>
                    <td><span class="status-badge status-${withdrawal.status}">${withdrawal.status}</span></td>
                `;
            });
        });
}

// ==========================================
// 16. DEPOSIT PAGE
// ==========================================

function setupDepositPage() {
    let depositAmount = 0;
    let selectedPackage = null;
    
    // Load packages and pre-select if ID is in URL
    db.collection('packages').where('visible', '==', true).orderBy('min_deposit').get()
        .then(snapshot => {
            const select = document.getElementById('deposit-package');
            if (select) {
                snapshot.forEach(doc => {
                    const pkg = doc.data();
                    const option = document.createElement('option');
                    option.value = doc.id;
                    option.textContent = `${pkg.title} (${pkg.daily_return_percent}% daily)`;
                    option.dataset.min = pkg.min_deposit;
                    option.dataset.max = pkg.max_deposit;
                    select.appendChild(option);
                });
                
                // Check if URL has a pre-selected package
                const urlParams = new URLSearchParams(window.location.search);
                const packageId = urlParams.get('package');
                if (packageId) {
                    select.value = packageId;
                }
            }
        });
    
    const amountForm = document.getElementById('deposit-amount-form');
    if (amountForm) {
        amountForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            depositAmount = parseFloat(document.getElementById('deposit-amount').value);
            const packageSelect = document.getElementById('deposit-package');
            selectedPackage = packageSelect.value;
            
            if (selectedPackage) {
                const selectedOption = packageSelect.options[packageSelect.selectedIndex];
                const min = parseFloat(selectedOption.dataset.min);
                const max = parseFloat(selectedOption.dataset.max);
                if (depositAmount < min || depositAmount > max) {
                    alert(`Amount must be between ${formatCurrency(min)} and ${formatCurrency(max)} for this package.`);
                    return;
                }
            } else if (depositAmount < 100) {
                 alert('Minimum deposit is $100');
                 return;
            }
            
            try {
                const contentDoc = await db.collection('site_content').doc('main').get();
                const depositAddress = contentDoc.exists ? contentDoc.data().deposit_address : 'Loading...';
                document.getElementById('deposit-address-display').textContent = depositAddress;
                document.getElementById('deposit-amount-display').textContent = formatCurrency(depositAmount);
                goToDepositStep(2);
            } catch (error) {
                alert('Error loading deposit address. Please try again.');
            }
        });
    }
    
    const copyAddressBtn = document.getElementById('copy-address-btn');
    if (copyAddressBtn) {
        copyAddressBtn.addEventListener('click', () => {
            const address = document.getElementById('deposit-address-display').textContent;
            try {
                // Use modern clipboard API
                navigator.clipboard.writeText(address).then(() => {
                    copyAddressBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 10l3 3 7-7"/></svg>';
                    setTimeout(() => {
                        copyAddressBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="10" height="10" rx="1"/><path d="M4 14V4h10"/></svg>';
                    }, 2000);
                });
            } catch (err) {
                // Fallback for insecure contexts (like http)
                const textArea = document.createElement("textarea");
                textArea.value = address;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand("copy");
                textArea.remove();
                copyAddressBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 10l3 3 7-7"/></svg>';
                setTimeout(() => {
                    copyAddressBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="10" height="10" rx="1"/><path d="M4 14V4h10"/></svg>';
                }, 2000);
            }
        });
    }
    
    document.getElementById('proceed-to-confirm')?.addEventListener('click', () => goToDepositStep(3));
    document.getElementById('back-to-amount')?.addEventListener('click', () => goToDepositStep(1));
    document.getElementById('back-to-payment')?.addEventListener('click', () => goToDepositStep(2));
    
    const confirmForm = document.getElementById('deposit-confirm-form');
    if (confirmForm) {
        confirmForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoading('deposit-submit-btn');
            
            const txHash = document.getElementById('tx-hash').value;
            const proofUrl = document.getElementById('deposit-proof-url').value; 

            try {
                await db.collection('deposits').add({
                    user_id: currentUser.uid,
                    user_email: currentUser.email,
                    amount: depositAmount,
                    package_id: selectedPackage || null,
                    tx_hash: txHash,
                    proof_url: proofUrl, 
                    screenshot_url: proofUrl, // For admin panel compatibility
                    status: 'pending',
                    created_at: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                showSuccess('deposit-success', 'Deposit submitted successfully! Approval time: 0-60 minutes.');
                
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 3000);
                
            } catch (error) {
                console.error('Deposit error:', error);
                showError('deposit-error', 'Failed to submit deposit. Please try again.');
                showLoading('deposit-submit-btn', false);
            }
        });
    }
}

function goToDepositStep(stepNumber) {
    document.querySelectorAll('.deposit-form-step').forEach(step => step.classList.remove('active'));
    document.getElementById(`deposit-step-${stepNumber}`).classList.add('active');
    document.querySelectorAll('.deposit-step').forEach((step, index) => {
        if (index < stepNumber) {
            step.classList.add('active');
        } else {
            step.classList.remove('active');
        }
    });
}

// ==========================================
// 17. WITHDRAW PAGE
// ==========================================

function setupWithdrawPage() {
    if (!currentUser) return;
    
    // Balance is already live from setupUser()
    
    const withdrawForm = document.getElementById('withdraw-form');
    if (withdrawForm) {
        withdrawForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoading('withdraw-submit-btn');
            
            const amount = parseFloat(document.getElementById('withdraw-amount').value);
            const address = document.getElementById('withdraw-address').value;
            const notes = document.getElementById('withdraw-notes').value;
            
            if (amount < 10) {
                showError('withdraw-error', 'Minimum withdrawal is $10');
                showLoading('withdraw-submit-btn', false);
                return;
            }
            if (amount > userBalance) {
                showError('withdraw-error', 'Insufficient balance');
                showLoading('withdraw-submit-btn', false);
                return;
            }
            
            try {
                await db.collection('withdrawals').add({
                    user_id: currentUser.uid,
                    user_email: currentUser.email,
                    amount: amount,
                    address: address,
                    notes: notes || '',
                    status: 'pending',
                    created_at: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                showSuccess('withdraw-success', 'Withdrawal request submitted! Approval time: 0-60 minutes.');
                withdrawForm.reset();
                
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 3000);
                
            } catch (error) {
                console.error('Withdrawal error:', error);
                showError('withdraw-error', 'Failed to submit withdrawal. Please try again.');
            }
            showLoading('withdraw-submit-btn', false);
        });
    }
    
    loadWithdrawalHistory('withdraw-history-tbody');
}

function loadWithdrawalHistory(tbodyId) {
    const historyTbody = document.getElementById(tbodyId);
    if (!historyTbody || !currentUser) return;

    db.collection('withdrawals')
        .where('user_id', '==', currentUser.uid)
        .orderBy('created_at', 'desc')
        .onSnapshot((snapshot) => {
            if (snapshot.empty) {
                historyTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No withdrawal history</td></tr>';
                return;
            }
            historyTbody.innerHTML = '';
            snapshot.forEach((doc) => {
                const withdrawal = doc.data();
                const row = historyTbody.insertRow();
                row.innerHTML = `
                    <td>${formatDate(withdrawal.created_at)}</td>
                    <td>${formatCurrency(withdrawal.amount)}</td>
                    <td>${withdrawal.address ? withdrawal.address.substring(0, 20) + '...' : 'N/A'}</td>
                    <td><span class="status-badge status-${withdrawal.status}">${withdrawal.status}</span></td>
                    <td>${withdrawal.admin_notes || '-'}</td>
                `;
            });
        });
}

// ==========================================
// 18. PROFILE PAGE
// ==========================================

async function loadProfilePage() {
    if (!currentUser) return;
    const userDocRef = db.collection('users').doc(currentUser.uid);
    
    // User data (balance) is already loading from the setupUser() listener
    
    // Load statistics
    loadProfileStats();
    
    // Fill in static info
    userDocRef.get().then(doc => {
         if (doc.exists) {
            const userData = doc.data();
            document.getElementById('profile-email').textContent = currentUser.email;
            document.getElementById('profile-joined-date').textContent = formatDate(userData.created_at);
            
            const profilePicImg = document.getElementById('profile-pic-img');
            if (profilePicImg) {
                // Use a default SVG and then fill with UI Avatars
                profilePicImg.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.email)}&background=3B82F6&color=fff&size=120`;
            }
            
            document.getElementById('profile-info-email').textContent = currentUser.email;
            document.getElementById('profile-info-uid').textContent = currentUser.uid.substring(0, 20) + '...';
            document.getElementById('profile-info-created').textContent = formatDate(userData.created_at);
            document.getElementById('profile-info-last-login').textContent = formatDate(userData.last_login);
         }
    });
}

async function loadProfileStats() {
    if (!currentUser) return;
    try {
        const depositsSnapshot = await db.collection('deposits')
            .where('user_id', '==', currentUser.uid)
            .where('status', '==', 'approved')
            .get();
        
        let totalDeposits = 0;
        depositsSnapshot.forEach(doc => { totalDeposits += doc.data().amount || 0; });
        
        const withdrawalsSnapshot = await db.collection('withdrawals')
            .where('user_id', '==', currentUser.uid)
            .where('status', '==', 'approved')
            .get();
        
        let totalWithdrawals = 0;
        withdrawalsSnapshot.forEach(doc => { totalWithdrawals += doc.data().amount || 0; });
        
        const totalEarnings = userBalance + totalWithdrawals; // userBalance is live
        
        document.getElementById('profile-total-earnings').textContent = formatCurrency(totalEarnings);
        document.getElementById('profile-total-deposits').textContent = formatCurrency(totalDeposits);
        document.getElementById('profile-total-withdrawals').textContent = formatCurrency(totalWithdrawals);
        
        const totalTransactions = depositsSnapshot.size + withdrawalsSnapshot.size;
        document.getElementById('profile-total-transactions').textContent = totalTransactions;
        
    } catch (error) {
        console.error('Error loading profile stats:', error);
    }
}

// ==========================================
// 19. REFERRAL PAGE
// ==========================================
async function loadReferralPage() {
    if (!currentUser) return;
    
    // Set the referral link
    const refLinkInput = document.getElementById('referral-link');
    const refLink = `https://roobux.site/index.html?ref=${currentUser.uid}`;
    if (refLinkInput) {
        refLinkInput.value = refLink;
    }
    
    // Copy button
    const copyRefBtn = document.getElementById('copy-referral-btn');
    if (copyRefBtn) {
        copyRefBtn.addEventListener('click', () => {
            refLinkInput.select();
            document.execCommand('copy');
            copyRefBtn.textContent = 'Copied!';
            setTimeout(() => { copyRefBtn.textContent = 'Copy'; }, 2000);
        });
    }

    // Load referral stats
    try {
        const refSettingsDoc = await db.collection('site_content').doc('referrals').get();
        const settings = refSettingsDoc.exists ? refSettingsDoc.data() : { referrerPercent: 0, newUserBonus: 0 };
        
        const safeSet = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        safeSet('ref-stat-new-user', formatCurrency(settings.newUserBonus || 0));
        safeSet('ref-stat-referrer', `${settings.referrerPercent || 0}%`);

        // Get this user's referral history
        const historySnapshot = await db.collection('referrals')
            .where('referrer_id', '==', currentUser.uid)
            .orderBy('created_at', 'desc')
            .get();
            
        let totalEarned = 0;
        const tbody = document.getElementById('referral-history-tbody');
        if (tbody) {
            tbody.innerHTML = '';
            if (historySnapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No referrals yet.</td></tr>';
            } else {
                historySnapshot.forEach(doc => {
                    const data = doc.data();
                    totalEarned += data.bonus_paid;
                    const row = tbody.insertRow();
                    row.innerHTML = `
                        <td>${formatDate(data.created_at)}</td>
                        <td>${data.new_user_email}</td>
                        <td>${formatCurrency(data.bonus_paid)}</td>
                    `;
                });
            }
        }
        safeSet('ref-stat-total-earned', formatCurrency(totalEarned));
        safeSet('ref-stat-total-users', historySnapshot.size);

    } catch (error) {
        console.error("Error loading referral stats: ", error);
    }
}

// ==========================================
// 20. SUPPORT CHAT PAGE
// ==========================================
function loadSupportChatPage() {
    if (!currentUser) return;
    
    const messagesContainer = document.getElementById('support-messages-container');
    const form = document.getElementById('support-chat-form');
    const topicSelect = document.getElementById('support-topic');
    const messageInput = document.getElementById('support-message-input');
    const startView = document.getElementById('support-start-view');
    const chatView = document.getElementById('support-chat-view');
    
    // Stop any previous chat listener
    if (chatUnsubscribe) chatUnsubscribe();
    
    // Listen for new messages
    const messagesRef = db.collection('support_chats').doc(currentUser.uid).collection('messages').orderBy('timestamp');
    chatUnsubscribe = messagesRef.onSnapshot((snapshot) => {
        
        if (snapshot.empty) {
            // No chat history, show the "start chat" view
            startView.classList.remove('hidden');
            chatView.classList.add('hidden');
        } else {
            // Chat history exists, show the chat view
            startView.classList.add('hidden');
            chatView.classList.remove('hidden');
            
            messagesContainer.innerHTML = '';
            snapshot.forEach(doc => {
                const msg = doc.data();
                const msgDiv = document.createElement('div');
                msgDiv.className = `chat-message ${msg.sender === 'admin' ? 'admin' : 'user'}`;
                msgDiv.textContent = msg.text;
                messagesContainer.appendChild(msgDiv);
            });
            // Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        // Mark chat as read by user
        db.collection('support_chats').doc(currentUser.uid).set({ user_has_unread: false }, { merge: true });
    });

    // Handle sending a message (works for both starting a chat and replying)
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let text = messageInput.value.trim();
        if (text === '') return;
        
        // If this is the *first* message, add the topic
        if (startView.classList.contains('hidden') === false) {
            const topic = topicSelect.value;
            if (!topic) {
                alert('Please select a topic.');
                return;
            }
            text = `TOPIC: ${topic}\n\n${text}`;
        }
        
        showLoading('support-send-btn');
        messageInput.value = ''; // Clear input
        
        const message = {
            sender: currentUser.uid,
            text: text,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        try {
            // Add the new message to the subcollection
            await db.collection('support_chats').doc(currentUser.uid).collection('messages').add(message);
            
            // Update/create the parent document for the admin panel
            await db.collection('support_chats').doc(currentUser.uid).set({
                last_message: text,
                last_updated: firebase.firestore.FieldValue.serverTimestamp(),
                user_email: currentUser.email,
                admin_has_unread: true // Mark as unread for the admin
            }, { merge: true });
            
        } catch (error) {
            console.error("Error sending message:", error);
            alert("Failed to send message. Please try again.");
        }
        showLoading('support-send-btn', false);
    });
}


// ==========================================
// RUN ON PAGE LOAD
// ==========================================

// Use DOMContentLoaded to ensure elements are ready
document.addEventListener('DOMContentLoaded', initializeSite);

