# PromptCraft Website

A modern, responsive landing page for PromptCraft - an AI-powered prompt optimization tool. Built with semantic HTML5, modular CSS, and vanilla JavaScript following industry best practices.

## 🏗️ Project Structure

```
PC-site/
├── index.html              # Main HTML file
├── css/
│   └── styles.css          # Main stylesheet
├── js/
│   └── main.js            # Main JavaScript file
├── assets/                 # Static assets (images, icons, etc.)
├── package.json           # Node.js dependencies and scripts
└── README.md              # Project documentation
```

## 🚀 Features

- **Responsive Design**: Mobile-first approach with fluid layouts
- **Modern CSS**: CSS Grid, Flexbox, custom properties (CSS variables)
- **Semantic HTML**: Proper heading hierarchy, ARIA labels, screen reader support
- **Performance Optimized**: Lazy loading, efficient animations, optimized assets
- **Cross-browser Compatible**: Supports all modern browsers
- **Accessibility**: WCAG 2.1 compliant with keyboard navigation support
- **Interactive Elements**: Custom cursor, smooth scrolling, hover effects
- **SEO Optimized**: Meta tags, Open Graph, Twitter Cards

## 🛠️ Development

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/colingalbraith/PromptCraft.git
   cd PC-site
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```
   This will start a live server at `http://localhost:3000`

### Available Scripts

- `npm run dev` - Start development server with live reload
- `npm run build` - Build optimized production files
- `npm run lint:css` - Lint CSS files
- `npm run lint:js` - Lint JavaScript files
- `npm run format` - Format all files with Prettier
- `npm run validate:html` - Validate HTML markup
- `npm run lighthouse` - Run Lighthouse performance audit
- `npm run test` - Run all linting and validation tests

## 📁 File Organization

### CSS Architecture

The stylesheet follows a modular approach with clear sections:

- **Variables**: CSS custom properties for colors, fonts, spacing
- **Global Styles**: Reset, base typography, accessibility
- **Components**: Reusable UI components (buttons, cards, etc.)
- **Layout**: Page structure (header, hero, sections, footer)
- **Animations**: Keyframes and transitions
- **Responsive**: Media queries for different screen sizes

### JavaScript Modules

The main.js file is organized into modules:

- **App**: Main application initialization
- **Cursor**: Custom cursor functionality
- **BackgroundOrbs**: Animated background elements
- **Header**: Navigation and scroll effects
- **ScrollAnimations**: Intersection Observer animations
- **InteractiveDemo**: Live prompt transformation demo
- **Navigation**: Smooth scrolling and keyboard navigation
- **Performance**: Optimization utilities

## 🎨 Design System

### Colors

```css
:root {
    --primary: #E97D47;        /* Orange primary */
    --primary-dark: #D86B38;   /* Darker orange */
    --primary-light: #F29B71;  /* Lighter orange */
    --secondary: #2D2D2D;      /* Dark gray */
    --text-dark: #1A1A1A;      /* Primary text */
    --text-light: #666666;     /* Secondary text */
    --bg-light: #FAFAFA;       /* Light background */
    --bg-white: #FFFFFF;       /* White background */
}
```

### Typography

- **Font Family**: Inter (Google Fonts)
- **Font Weights**: 300, 400, 500, 600, 700, 800, 900
- **Base Font Size**: 16px
- **Line Height**: 1.6

### Spacing

- Based on 8px grid system
- Consistent padding and margins
- Responsive spacing using clamp()

## 📱 Responsive Breakpoints

- **Mobile**: < 768px
- **Tablet**: 768px - 1024px  
- **Desktop**: > 1024px
- **Large Desktop**: > 1400px

## ♿ Accessibility Features

- Semantic HTML5 elements
- ARIA labels and roles
- Keyboard navigation support
- Screen reader compatibility
- High contrast mode support
- Reduced motion preferences
- Focus indicators
- Alt text for images

## 🔧 Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## 📈 Performance

- Lighthouse Score: 95+ (Performance, Accessibility, Best Practices, SEO)
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Total Blocking Time: < 300ms

## 🚀 Deployment

### Static Hosting

The site can be deployed to any static hosting service:

- **Netlify**: Drag and drop the folder
- **Vercel**: Connect GitHub repository
- **GitHub Pages**: Enable in repository settings
- **Surge.sh**: `surge` command after installing surge CLI

### Build Process

```bash
npm run build
```

This creates minified CSS and JavaScript files for production.

## 🧪 Testing

### HTML Validation
```bash
npm run validate:html
```

### CSS Linting
```bash
npm run lint:css
```

### JavaScript Linting
```bash
npm run lint:js
```

### Performance Testing
```bash
npm run lighthouse
```

## 📝 Code Style

- **HTML**: Semantic, properly indented, lowercase attributes
- **CSS**: BEM methodology, mobile-first, logical properties
- **JavaScript**: ES6+, modular architecture, camelCase naming
- **Comments**: Clear, descriptive comments for complex logic

## 🔮 Future Enhancements

- [ ] Add dark mode toggle
- [ ] Implement service worker for offline support
- [ ] Add micro-animations with Framer Motion
- [ ] Integrate with a headless CMS
- [ ] Add A/B testing capabilities
- [ ] Implement progressive image loading
- [ ] Add contact form functionality

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👥 Team

- **Design**: UI/UX Team
- **Development**: Frontend Team
- **Content**: Marketing Team

## 📞 Support

For support, email support@promptcraft.com or join our Discord community.

---

Built with ❤️ for the AI community
