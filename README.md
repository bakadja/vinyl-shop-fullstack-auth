# 🎵 Spiral Sounds - Vinyl Shop

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.21.2-blue.svg)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3-lightgrey.svg)](https://www.sqlite.org/)

A full-stack web application for a vintage vinyl record store with user authentication, shopping cart functionality, and product management. Built with Node.js, Express, and SQLite.

![Spiral Sounds Logo](public/images/spiral_logo.png)

## 📋 Table of Contents

- [Features](#features)
- [Demo](#demo)
- [Installation](#installation)
- [Usage](#usage)
- [Tests](#tests)
- [API Documentation](#api-documentation)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

### 🔐 User Authentication
- User registration and login
- Secure password hashing with bcryptjs
- Session-based authentication
- Protected routes and middleware

### 🛒 Shopping Cart
- Add/remove items from cart
- Persistent cart storage in SQLite database
- Real-time cart updates
- User-specific cart management

### 🎼 Product Management
- Browse vinyl record collection
- Product details and images
- Responsive product grid layout
- SQLite database for product storage

### 🎨 User Interface
- Clean, modern design
- Responsive layout for all devices
- Interactive menu and navigation
- Professional styling with CSS

## 🚀 Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn package manager

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone https://github.com/bakadja/vinyl-shop-fullstack-auth.git
   cd vinyl-shop-fullstack-auth
   ```

2. **Install dependencies**
   ```bash
   npm ci
   ```

3. **Set up environment variables** (optional)
   ```bash
   export SPIRAL_SESSION_SECRET="your-secret-key-here"
   ```
   *Note: If not set, a default secret will be used for development*

4. **Initialize the database**
   From the repository root, run:
   ```bash
   npm run db:init
   ```
   This creates a local `database.db` from `db/init.sql`, with ten fictional demo
   records and empty `users` and `cart_items` tables. Create a new account through
   the signup page; no old accounts or carts are imported.

   Initialization refuses to overwrite an existing database. If updating an old
   checkout, back up your local database outside the repository, then explicitly
   move or remove `database.db` before running the command. Existing databases are
   not sanitized automatically. SQLite files and journals are ignored by Git.

   Removing the database from the current source tree does not remove copies from
   earlier Git commits; this change does not rewrite repository history.

5. **Start the server**
   ```bash
   npm start
   ```

6. **Open your browser**
   Navigate to `http://localhost:8000`

## 🎯 Usage

### For Customers

1. **Browse Products**: Visit the homepage to view available vinyl records
2. **Create Account**: Sign up for a new account or log in to an existing one
3. **Add to Cart**: Browse products and add items to your shopping cart
4. **Manage Cart**: View and modify items in your cart
5. **Checkout**: Complete your purchase (checkout functionality may need to be implemented)

### For Developers

The application provides RESTful API endpoints for:

- **Authentication**: `/api/auth/*`
- **Products**: `/api/products/*`
- **Cart Management**: `/api/cart/*`
- **User Profile**: `/api/auth/me`

## Tests

```bash
npm ci
npm test                         # All 19 tests: 5 database + 14 HTTP scenarios
node --test test/database.test.js # Original database tests only
node --test test/api.test.js      # HTTP integration tests only
```

No `npm run db:init`, running development server, `.env`, or external service is
required for tests. The suite uses the built-in Node.js test runner and native
`fetch`; no additional dependencies are installed. CI uses Node.js 24 on Ubuntu.

Each HTTP scenario initializes a fictional catalogue in a new OS temporary
directory and starts the real `server.js` in a separate process with that directory
as its working directory. Because SQLite resolves `database.db` relative to the
working directory, these requests never open the development database. `PORT=0`
assigns a free port; each server gets a randomly generated, disposable session
secret. Independent HTTP clients retain separate session cookies. Servers are
stopped before their temporary databases are removed, including on test failure.

The HTTP scenarios cover registration, input validation, duplicate accounts,
hashed password storage, login and invalid credentials, session inspection,
logout with reuse of the old cookie, anonymous access to all five cart endpoints,
public catalogue/genres/filtering/search, cart quantities/counts/removal/clearing,
cart persistence across login, and isolation between two users. Isolation checks
include the same product in both carts, attempts to delete the other user's item,
and clearing one cart without changing the other. The five original database
tests remain unchanged.

`.github/workflows/api-tests.yml` runs `npm ci` and `npm test` on every pull request
targeting `main`, including drafts. It uses read-only repository permissions and
does not require secrets or deploy the application.

### Known issues and limits

- A temporary-database HTTP probe found that adding nonexistent `productId: 9999`
  returns 200 and increases the cart count to 1, while listing the cart returns
  no items. The add route does not check product existence, and runtime SQLite
  connections do not enable foreign-key enforcement. This business behavior is
  left unchanged; the passing suite does not assert that nonexistent products are
  rejected. Nonnumeric product IDs and missing cart-item deletion are covered.
- The README previously listed `/signup` and `POST /logout`; it now documents
  the actual routes, `/register` and `GET /logout`.
- `npm ci` reported 20 existing dependency vulnerabilities locally (2 low,
  4 moderate, 12 high, 2 critical). Dependencies and the lockfile are unchanged;
  vulnerability remediation is outside this PR.
- These are API integration tests, not browser/UI, load, or a complete security
  audit. Static assets are not served from the repository in the temporary working
  directory. Production session storage, CSRF protection, malformed input types,
  concurrent requests, and stock enforcement are outside the covered scenarios.

## 📚 API Documentation

### Authentication Endpoints

```http
POST /api/auth/register     # Register new user
POST /api/auth/login      # User login
GET  /api/auth/logout     # User logout
GET  /api/auth/me         # Get current user profile
```

### Product Endpoints

```http
GET /api/products         # Get all products
GET /api/products/genres  # Get all available genres
GET /api/products?genre=indie    # Get products filtered by genre
```

### Cart Endpoints

```http
GET    /api/cart               # Get all cart items for user
POST   /api/cart/add          # Add a newly purchased item
DELETE /api/cart/all          # Delete all user's cart items
DELETE /api/cart/:itemId       # Delete a specific item
GET    /api/cart/cart-count   # Get the number of items a user has in their cart
```

## 📁 Project Structure

```
vinyl-shop-fullstack-auth/
├── controllers/           # Route handlers and business logic
│   ├── authController.js
│   ├── cartController.js
│   ├── meController.js
│   └── productsController.js
├── db/                   # Database configuration
│   └── db.js
├── middleware/           # Custom middleware
│   └── requireAuth.js
├── public/              # Frontend static files
│   ├── css/
│   ├── images/
│   ├── js/
│   ├── *.html
├── routes/              # API route definitions
│   ├── auth.js
│   ├── cart.js
│   ├── me.js
│   └── products.js
├── server.js            # Main application entry point
├── package.json
└── README.md
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SPIRAL_SESSION_SECRET` | Secret key for session encryption | `jellyfish-baskingshark` |
| `PORT` | Server port | `8000` |

### Database

Initialize a fresh local demo database with `npm run db:init`. Run `npm test` to
verify the schema, empty account/cart tables, catalogue image paths and filtering,
new-user/cart queries, CLI initialization, and protection against overwriting an
existing database. Tests use temporary databases and never access your local data.

The application uses SQLite for data persistence with the following tables:
- `users` - User account information
- `products` - Vinyl record inventory
- `cart_items` - Shopping cart data

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Guidelines

- Follow JavaScript ES6+ standards
- Use meaningful commit messages
- Test your changes thoroughly
- Update documentation as needed

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Express.js](https://expressjs.com/) for the backend framework
- [SQLite](https://www.sqlite.org/) for lightweight database storage
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js/) for secure password hashing
- Vinyl record images and assets for the demo store

---

**Made with ❤️ by Kevin Ngongang**

For questions or support, please open an issue on GitHub.
 
