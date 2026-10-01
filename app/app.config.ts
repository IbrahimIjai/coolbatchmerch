export default defineAppConfig({
  ui: {
    colors: {
      primary: 'neutral',
      neutral: 'neutral'
    },
    icons: {
      dark: 'i-lucide-moon',
      light: 'i-lucide-sun'
    },
    button: {
      slots: {
        base: 'rounded-lg font-medium transition-colors duration-150'
      },
      variants: {
        size: {
          xs: {
            base: 'px-2.5 text-xs'
          },
          sm: {
            base: 'px-3 text-xs'
          },
          md: {
            base: 'px-3 text-sm',
            leadingIcon: 'size-4',
            trailingIcon: 'size-4'
          },
          lg: {
            base: 'px-4 text-sm',
            leadingIcon: 'size-4',
            trailingIcon: 'size-4'
          },
          xl: {
            base: 'px-4 py-2.5 text-sm',
            leadingIcon: 'size-4',
            trailingIcon: 'size-4'
          }
        }
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'solid'
      }
    },
    input: {
      slots: {
        base: 'rounded-lg'
      }
    },
    textarea: {
      slots: {
        base: 'rounded-lg'
      }
    },
    card: {
      slots: {
        root: 'rounded-xl'
      }
    },
    dropdownMenu: {
      slots: {
        content: 'rounded-2xl bg-default shadow-(--ds-shadow-floating)',
        item: 'rounded-lg before:rounded-lg'
      }
    },
    modal: {
      variants: {
        fullscreen: {
          false: {
            content: 'rounded-2xl shadow-(--ds-shadow-floating)'
          }
        }
      }
    }
  }
})
