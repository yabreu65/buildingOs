# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - heading "BuildingOS" [level=1] [ref=e6]
        - paragraph [ref=e7]: Inicia sesión con tu cuenta
      - generic [ref=e8]:
        - generic [ref=e9]:
          - generic [ref=e10]: Email
          - textbox "Email" [ref=e11]:
            - /placeholder: tu@email.com
            - text: admin@demo.com
        - generic [ref=e12]:
          - generic [ref=e13]: Contraseña
          - textbox "Contraseña" [ref=e14]:
            - /placeholder: ••••••••
            - text: Admin123!
        - generic [ref=e15]: Too many requests, please try again later
        - button "Iniciar sesión" [ref=e16]
      - paragraph [ref=e18]:
        - text: ¿No tienes cuenta?
        - link "Crea una" [ref=e19]:
          - /url: /signup
    - generic [ref=e20]: © 2026 BuildingOS
  - generic [ref=e25] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e26]:
      - img [ref=e27]
    - generic [ref=e32]:
      - button "Open issues overlay" [ref=e33]:
        - generic [ref=e34]:
          - generic [ref=e35]: "0"
          - generic [ref=e36]: "1"
        - generic [ref=e37]: Issue
      - button "Collapse issues badge" [ref=e38]:
        - img [ref=e39]
  - alert [ref=e41]
```