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
   npm install
   ```

3. **Set up environment variables** (optional)
   ```bash
   export SPIRAL_SESSION_SECRET="your-secret-key-here"
   ```
   *Note: If not set, a default secret will be used for development*

4. **Initialize the database**
   The SQLite database will be automatically created when you first run the application.

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

## 📚 API Documentation

### Authentication Endpoints

```http
POST /api/auth/signup     # Register new user
POST /api/auth/login      # User login
POST /api/auth/logout     # User logout
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
 
