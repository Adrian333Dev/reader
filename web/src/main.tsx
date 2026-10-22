import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "github-markdown-css/github-markdown.css"
import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster position="top-right" />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
