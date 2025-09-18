# Authentication API Reference

## Base URL
```
https://api.example.com/v1/auth
```

## Endpoints

### POST /register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "user_123",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "isVerified": false,
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "message": "Registration successful. Please check your email for verification."
}
```

### POST /login
Authenticate user and get access token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "rt_456789",
    "expiresIn": 3600,
    "user": {
      "id": "user_123",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe"
    }
  }
}
```

### POST /refresh
Refresh access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "rt_456789"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600
  }
}
```

### POST /verify
Verify email address with verification code.

**Request Body:**
```json
{
  "email": "user@example.com",
  "verificationCode": "123456"
}
```

### POST /forgot-password
Request password reset.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

### POST /reset-password
Reset password with token.

**Request Body:**
```json
{
  "resetToken": "reset_token_here",
  "newPassword": "newSecurePassword123"
}
```

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Valid email address is required"
      }
    ]
  }
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid credentials"
  }
}
```

### 429 Too Many Requests
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 300
  }
}
```

## Rate Limits

- **Registration**: 5 requests per hour per IP
- **Login**: 10 requests per minute per IP
- **Password Reset**: 3 requests per hour per email
- **General**: 100 requests per minute per authenticated user

## Headers

### Required Headers
```
Content-Type: application/json
```

### Authentication Headers
```
Authorization: Bearer {accessToken}
```

## Status Codes

| Code | Description |
|------|-------------|
| 200  | Success |
| 201  | Created |
| 400  | Bad Request |
| 401  | Unauthorized |
| 403  | Forbidden |
| 404  | Not Found |
| 429  | Too Many Requests |
| 500  | Internal Server Error |