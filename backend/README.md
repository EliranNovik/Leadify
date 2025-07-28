# Backend Server

A Node.js/Express backend server for managing users with Supabase integration.

## Features

- ✅ User creation in both Supabase Auth and custom users table
- ✅ User management (CRUD operations)
- ✅ Password updates
- ✅ Secure API endpoints
- ✅ CORS configuration
- ✅ Error handling and logging

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy the example environment file and configure your variables:

```bash
cp env.example .env
```

Update `.env` with your Supabase credentials:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Supabase Configuration
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here

# JWT Configuration
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=24h

# CORS Configuration
CORS_ORIGIN=http://localhost:5173

# Security
BCRYPT_ROUNDS=12
```

### 3. Get Supabase Credentials

1. Go to your Supabase project dashboard
2. Navigate to Settings > API
3. Copy the following values:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`
   - **anon key** → `SUPABASE_ANON_KEY`

### 4. Run the Server

**Development mode (with auto-restart):**

```bash
npm run dev
```

**Production mode:**

```bash
npm start
```

## API Endpoints

### Users

- `POST /api/users` - Create a new user
- `GET /api/users` - Get all users
- `PUT /api/users/:userId/password` - Update user password
- `PUT /api/users/:userId` - Update user details
- `DELETE /api/users/:userId` - Delete user

### Health Check

- `GET /health` - Server health status

## Example Usage

### Create a User

```bash
curl -X POST http://localhost:3001/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepassword123",
    "full_name": "John Doe",
    "first_name": "John",
    "last_name": "Doe",
    "role": "user",
    "is_active": true,
    "is_staff": false,
    "is_superuser": false
  }'
```

### Get All Users

```bash
curl http://localhost:3001/api/users
```

### Update User Password

```bash
curl -X PUT http://localhost:3001/api/users/USER_ID/password \
  -H "Content-Type: application/json" \
  -d '{
    "newPassword": "newsecurepassword123"
  }'
```

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── supabase.js      # Supabase configuration
│   ├── controllers/
│   │   └── userController.js # HTTP request handlers
│   ├── routes/
│   │   └── userRoutes.js    # API routes
│   ├── services/
│   │   └── userService.js   # Business logic
│   ├── middleware/
│   └── utils/
├── server.js                 # Main server file
├── package.json
└── README.md
```

## Security Features

- ✅ Helmet.js for security headers
- ✅ CORS configuration
- ✅ Input validation
- ✅ Error handling
- ✅ Request logging with Morgan
- ✅ Environment variable protection

## Next Steps

1. Add authentication middleware
2. Add rate limiting
3. Add request validation
4. Add database migrations
5. Add testing suite
