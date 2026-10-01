export default defineAppConfig({
  ui: {
    colors: {
      primary: 'neutral',
      neutral: 'neutral'
    },
    button: {
      slots: {
        base: 'font-medium transition-colors duration-200'
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline'
      }
    },
    slideover: {
      slots: {
        content: 'shadow-[0_8px_40px_rgb(39_48_79/0.12)]'
      }
    }
  }
})
