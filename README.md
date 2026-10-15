# 🎵 Spiral Sounds - Vinyl Shop

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-24-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4-blue.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-blue.svg)](https://www.postgresql.org/)

A full-stack web application for a vintage vinyl record store with user authentication, shopping cart functionality, and product management. Built with Node.js 24, Express 4, and PostgreSQL.

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
- Persistent cart storage in PostgreSQL
- Real-time cart updates
- User-specific cart management

### 🎼 Product Management
- Browse vinyl record collection
- Product details and images
- Responsive product grid layout
- PostgreSQL database for product storage

### 🎨 User Interface
- Clean, modern design
- Responsive layout for all devices
- Interactive menu and navigation
- Professional styling with CSS

## 🚀 Installation

### Prerequisites

- Node.js 24
- PostgreSQL 17 (Docker/Colima or a separately managed server)
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

3. **Configure and start PostgreSQL**
   Copy `.env.example` to `.env`, replace its placeholders locally, then start the
   development database with `docker compose up -d --wait postgres` (or the
   standalone `docker-compose` equivalent). The `.env` file is optional: shell,
   CI and Azure environment variables are supported directly.

   See [PostgreSQL migration/setup](docs/postgresql-migration.md) for Colima on
   Apple Silicon, separate disposable tests, verified TLS and deliberate resets.
   Configure a cryptographically generated session signing key; see [secure sessions](docs/secure-sessions.md).

4. **Initialize the database**
   ```bash
   npm run db:init
   npm run db:init:sessions
   ```
   Seeds the same ten fictional products and no accounts/carts. Initialization is
   repeatable and preserves existing PostgreSQL rows, including password hashes.
   Existing SQLite databases are ignored and never imported automatically.

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
npm audit --audit-level=high
npm run test:postgres            # Starts/stops a new disposable PostgreSQL 17 cluster
# Or provision the separate Compose test service, export TEST_DATABASE_URL, then:
npm test
# On the disposable test database, generate native Node.js LCOV:
mkdir -p coverage
npm run test:coverage
```

Linux GitHub Actions also generates `coverage/lcov.info` and uploads the
`linux-lcov` artifact. Import into SonarQube Cloud requires switching from
automatic to CI-based analysis and supplying a repository `SONAR_TOKEN`
secret; the scanner remains gated until the owner completes that setup.
See [test coverage and SonarCloud](docs/sonar-coverage.md) for the secure
transition and important measurement limits.

The suite retains the original 57 behavioral tests, with documented PostgreSQL
adaptations for SQLite-specific setup and schema checks, and adds PostgreSQL
regressions. DOM XSS and frontend regression files remain unchanged.

Tests require a verified disposable test database, restricted role and
administrator-owned marker. Each integration fixture creates its own random
schema, runs the real HTTP server with explicit test configuration, and tears it
down before schema cleanup. Missing or unsafe test configuration fails the suite;
there is no development/production fallback or silent integration-test skip.
The native helper always creates a new private cluster, never uses a workstation
PostgreSQL service, and cleans it up on exit. It requires PostgreSQL 17 binaries
(`PG_TEST_BIN`) or Homebrew `postgresql@17`.

GitHub Actions runs the full suite on Linux (PostgreSQL service container) and
macOS (ephemeral native cluster), with Node 24 and a high/critical npm audit gate.
The mandatory check names remain `test`, `test-macos` and external
`SonarCloud Code Analysis`. See the [migration record](docs/postgresql-migration.md)
for validation results, schema differences and limitations. Historical findings
from previous SQLite PRs remain in the corresponding `docs/` change records.

## 📚 API Documentation

### Authentication Endpoints

```http
POST /api/auth/register     # Register new user
POST /api/auth/login      # User login
POST /api/auth/logout     # JSON body {}; GET/HEAD return 405, Allow: POST
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
| `SPIRAL_SESSION_SECRET` | Required 64-character hex signing key from 32 random bytes | None |
| `PORT` | Server port | `8000` |

### Database

PostgreSQL persists `users`, `products` and `cart_items`. Configure DATABASE_URL
or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD; verified TLS is required outside
loopback development. Never commit `.env`, credentials or personal database data.

`npm run db:init` initializes/seeds without overwriting existing rows.
See [PostgreSQL migration/setup](docs/postgresql-migration.md) for all configuration,
constraints, test safety rules, Azure compatibility and reset instructions.

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
- [PostgreSQL](https://www.postgresql.org/) and [node-postgres](https://node-postgres.com/) for database access
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js/) for secure password hashing
- Vinyl record images and assets for the demo store

---

**Made with ❤️ by Kevin Ngongang**

For questions or support, please open an issue on GitHub.
 

See [secure persistent sessions](docs/secure-sessions.md) for the breaking POST-only logout contract, explicit session initialization, secrets/rotation, cookie policy, verified-TLS security tests and the unverified Azure proxy deployment boundary.

### Backend error monitoring

Sentry error monitoring is optional and backend-only. See [Sentry configuration,
privacy policy and controlled acceptance probe](docs/sentry-backend.md) before
supplying a DSN. Real ingestion remains blocked pending the owner quota/privacy
review; no Azure readiness gate is opened by this integration.
