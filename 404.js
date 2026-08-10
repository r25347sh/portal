// Minimal 404 – no heavy logic needed
document.addEventListener("DOMContentLoaded", () => {
  // Optional subtle fade-in
  document.body.style.opacity = "0";
  requestAnimationFrame(() => {
    document.body.style.transition = "opacity 0.45s ease";
    document.body.style.opacity = "1";
  });
});