# Frontend Deployment Guide

## ✅ Backend URL Updated

Your frontend has been updated to use the deployed backend:

- **Backend URL**: `https://leadify-crm-backend.onrender.com`

## 🚀 Deploy Frontend to Vercel/Netlify

### Option 1: Vercel (Recommended)

1. **Go to [vercel.com](https://vercel.com)**
2. **Import your GitHub repository**
3. **Configure build settings**:

   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`

4. **Set Environment Variables**:

   ```
   VITE_BACKEND_URL=https://leadify-crm-backend.onrender.com
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

5. **Deploy**

### Option 2: Netlify

1. **Go to [netlify.com](https://netlify.com)**
2. **Import your GitHub repository**
3. **Configure build settings**:

   - **Build command**: `npm run build`
   - **Publish directory**: `dist`

4. **Set Environment Variables** (same as Vercel)
5. **Deploy**

## 🔧 Environment Variables

Make sure to set these in your deployment platform:

| Variable                 | Value                                      |
| ------------------------ | ------------------------------------------ |
| `VITE_BACKEND_URL`       | `https://leadify-crm-backend.onrender.com` |
| `VITE_SUPABASE_URL`      | Your Supabase project URL                  |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anonymous key                |

## 🧪 Test Your Deployment

After deploying your frontend:

1. **Test API calls** to the backend
2. **Test authentication** with Supabase
3. **Test all major features**
4. **Check console for any errors**

## 📝 Update Backend CORS

Once your frontend is deployed, update the backend's `ALLOWED_ORIGINS` environment variable in Render to include your frontend URL:

```
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,https://your-frontend-domain.vercel.app
```

## 🎉 You're Done!

Your full-stack application is now deployed:

- **Backend**: `https://leadify-crm-backend.onrender.com`
- **Frontend**: `https://your-frontend-domain.vercel.app`
