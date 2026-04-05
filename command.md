# Voice Bridge - Running Commands

## Backend Server

**Development Mode (with auto-reload):**
```bash
cd backend
npm run dev
```

**Production Mode:**
```bash
cd backend
npm start
```

### Backend Details
- **Framework**: Express.js
- **Runtime**: Node.js
- **Database**: MongoDB with Mongoose
- **Port**: Check `.env` configuration
- **Key Dependencies**:
  - Express 5.2.1
  - MongoDB via Mongoose
  - JWT for authentication
  - FFmpeg for audio processing
  - Google Cloud Translate
  - Socket.io for real-time communication

---

## Frontend Application

**Start Expo Dev Server:**
```bash
cd frontend
npm start
```

**Run on Android:**
```bash
cd frontend
npm run android
```

**Run on iOS:**
```bash
cd frontend
npm run ios
```

**Run on Web:**
```bash
cd frontend
npm run web
```

### Frontend Details
- **Framework**: React Native with Expo
- **Router**: Expo Router
- **Key Dependencies**:
  - React 19.2.0
  - React Native 0.83.4
  - React Navigation for navigation
  - Expo 55.0.11
  - Socket.io-client for real-time communication
  - Audio recording with expo-audio
  - BLE (Bluetooth Low Energy) support with react-native-ble-plx

---

## Running Both Concurrently

To run both backend and frontend simultaneously:

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm start
```

---

## Additional Commands

### Backend Linting/Quality
- Check package.json for additional scripts

### Frontend Linting
```bash
cd frontend
npm run lint
```

### Reset Frontend Project
```bash
cd frontend
npm run reset-project
```

---

## Environment Setup

### Backend Configuration
Create a `.env` file in the `backend` directory with required variables:

```env
MONGO_URI=mongodb://your-database-url
JWT_SECRET=your-secret-key
```

The backend will crash without these environment variables configured.

### Frontend Configuration
Configuration typically handled through `expo.config.js` and environment variables.

---

## Current Status

- **Backend (Task b3ebi1dso)**: Running but requires `.env` configuration
- **Frontend (Task bydypj03u)**: Expo dev server running - scan QR code with Expo app to view

