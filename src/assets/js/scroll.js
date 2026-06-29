// Scroll to the top of the page when it's loaded. This overrides default browser behavior
window.onbeforeunload = function () {
  window.scrollTo(0, 0);
};

// When the user scrolls down 50px from the top of the document, resize the logo and move it.
window.onscroll = function () {
  scrollFunction();
};

// Global variables
let isTopOfPage = true;
const slideBox = document.querySelector("#slide-box");
const logoImage = document.querySelector("img#clt-logo");
const logoImageMini = document.querySelector("#clt-logo-mini");
const footer = document.querySelector("#clt-footer");
const footerText = document.querySelector(".clt-footer-text");

// Attach an onclick handler to the image, when clicked returns to top of the page
logoImageMini.addEventListener("click", function () {
  // scroll to top smoothly
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
});

function setIsTopOfPage(value) {
  isTopOfPage = !!value;
}

function scrollFunction() {
  let scrollPositionY = window.scrollY;

  // Background Parallax
  document.body.style.backgroundPositionY = -scrollPositionY * 0.08 + "px";

  if (scrollPositionY > 230) {
    setIsTopOfPage(false);
  }

  if (scrollPositionY < 230) {
    setIsTopOfPage(true);
  }

  if (isTopOfPage) {
    const scale = Math.max(0.33, 1 - scrollPositionY / 350); // Adjust divisor for sensitivity
    logoImage.style.transform = `scale(${scale})`; // Scale based on distance scrolled
    logoImage.style.transformOrigin = "top";
    logoImage.style.transition = "all 0.2s ease";
    logoImageMini.style.transition = "all 0.2s ease";

    logoImageMini.style.transform = "scale(0.33) translateY(-400px)";

    displayTopGradient(false);
  }

  if (!isTopOfPage) {
    logoImage.style.transform = "scale(0.33) translateY(-400px)";

    logoImageMini.style.transform = "scale(0.33) translateY(0)";
    logoImage.style.transition = "all 0.2s ease";
    logoImageMini.style.transition = "all 0.2s ease";
    displayTopGradient(true);
  }

  if (isElementInViewport(footerText)) {
    footer.classList.add("visible");
  } else {
    footer.classList.remove("visible");
  }
}

function displayTopGradient(shouldDisplay) {
  if (shouldDisplay) {
    // attach a new class to the div that will slide it in to view
    slideBox.classList.add("visible");
  }
  if (!shouldDisplay) {
    // Remove said class to let it slide out of view
    slideBox.classList.remove("visible");
  } else return;
}

function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <=
      (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}
