#!/bin/bash

echo "🚀 Leadify Backend Deployment Script"
echo "====================================="

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the backend directory"
    exit 1
fi

# Check if all required files exist
echo "📋 Checking required files..."

required_files=("server.js" "package.json" "src/routes/userRoutes.js" "src/routes/webhookRoutes.js" "src/routes/whatsappRoutes.js" "src/routes/teamsCallingRoutes.js" "src/routes/teamsBotRoutes.js")

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        exit 1
    fi
done

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
else
    echo "✅ Dependencies already installed"
fi

# Test the build
echo "🧪 Testing build..."
npm start &
SERVER_PID=$!
sleep 5

# Test health endpoint
if curl -s http://localhost:3001/health > /dev/null; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

# Stop the test server
kill $SERVER_PID 2>/dev/null

echo ""
echo "🎉 Backend is ready for deployment!"
echo ""
echo "📝 Next steps:"
echo "1. Push your code to GitHub/GitLab"
echo "2. Go to render.com and create a new Web Service"
echo "3. Connect your repository"
echo "4. Set environment variables (see env.example)"
echo "5. Deploy!"
echo ""
echo "📚 For detailed instructions, see DEPLOYMENT.md" 