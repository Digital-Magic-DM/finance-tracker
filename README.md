# Finance Tracker

Finance Tracker is a modern, high-performance personal finance and portfolio management application built with Angular. It allows users to unify their financial life by tracking incomes, expenses, investments (Stocks, ETFs, Mutual Funds, Gold), and overall net worth in a single, secure interface.

## 🌟 Key Features

*   **Aggregated Net Worth Dashboard**: A unified interface providing a bird's-eye view of your total wealth, combining liquid cash, stock market investments, mutual funds, and daily P&L.
*   **Real-Time Portfolio Valuation**: Connects to live market APIs (Yahoo Finance for Stocks/ETFs, MFAPI for Indian Mutual Funds) to fetch the exact current trading price of every held asset, dynamically rendering your daily financial standing.
*   **Smart Document Importer (Zero-Data-Entry)**: Intelligently parses exported statement files from platforms like **Groww** and **INDmoney**. It automatically recognizes columns, calculates weighted average entry prices, groups duplicates, and synchronizes them to the database.
*   **Custom Analytics & Chart Builder**: Features a robust `AnalyticsBuilderService` that allows you to create, save, and manage custom chart widgets filtered by time, category, or asset type.
*   **Progressive Web App (PWA) Support**: Feels native and can be installed directly onto an iOS or Android device from the browser. Leverages service workers for offline caching and fast loading.
*   **Privacy & Security First Model**: Data is strictly isolated using Firebase Auth and Firestore Security Rules. By relying on statement uploads rather than requesting Broker API tokens, you maintain total control over your data footprint.
*   **Brutalist / Domforge-inspired UI**: Highly optimized responsive design with a custom aesthetic, smooth micro-animations, and seamless Dark/Light mode switching.

## 🛠 Technology Stack

### Frontend
*   **Framework**: Angular v20 (Standalone Components)
*   **Reactivity**: RxJS and Angular Signals
*   **Styling**: Custom SCSS with a brutalist dark/light mode UI
*   **Data Visualization**: Chart.js
*   **Utilities**: SheetJS (`xlsx`) for CSV/Excel parsing, `pdfjs-dist` for PDF interactions.

### Backend & Infrastructure
*   **Platform**: Firebase (Auth, Firestore NoSQL, Hosting)
*   **PWA**: `@angular/service-worker`
*   **External APIs**: 
    *   Yahoo Finance API (Proxied for real-time equity data)
    *   MFAPI (`api.mfapi.in` for Indian Mutual Fund NAVs)

## 🚀 Development Setup

This project uses modern Angular CLI tooling.

### Prerequisites
*   Node.js (LTS version recommended)
*   Angular CLI (`npm install -g @angular/cli`)

### Running Locally
To start the local development server:

```bash
npm install
npm start
```
*Note: `npm start` runs `setup-env` before `ng serve`.*

Once running, navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

### Building for Production
To build the project for production:

```bash
npm run build
```
The build artifacts will be stored in the `dist/finance-tracker/browser` directory. 

### Deployment
The project is configured for Firebase Hosting.

```bash
npm run deploy
```
This script will build the application and deploy it using the Firebase CLI.

## 📄 License
Private and Confidential. All rights reserved.
