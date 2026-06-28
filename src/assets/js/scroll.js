// Scroll to the top of the page when it's loaded. This overrides default browser behavior
window.onbeforeunload = function () {
  // window.scrollTo(0, 0);
};

// When the user scrolls down 50px from the top of the document, resize the logo and move it.
window.onscroll = function () {
  scrollFunction();
};

// Global variables
let isTopOfPage = null;
const slideBox = document.querySelector("#slide-box");
const logoImage = document.querySelector("img#clt-logo");
// const logoImageMini = document.querySelector("#logo-mini");

function setIsTopOfPage(value) {
  isTopOfPage = !!value;
}

// Attach an onclick handler to the image, when clicked returns to top of the page
logoImage.addEventListener("click", function () {
  // scroll to top smoothly
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
});

function scrollFunction() {
  let scrollPositionY = window.scrollY;

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
    logoImage.classList.remove("mini-logo");
    // toggleReverse(logoImage);
    displayTopGradient(false);
    console.log("animation direction: ", logoImage.style.animationDirection);
  }

  if (!isTopOfPage) {
    logoImage.style.transform = "scale(0.33)";
    logoImage.classList.add("mini-logo");
    // toggleReverse(logoImage);
    displayTopGradient(true);
  }
}

function toggleReverse(image) {
  if (image.style.animationDirection === "reverse") {
    console.log("normal direction");
    image.style.animationDirection = "normal";
  } else {
    console.log("reversing direction");
    image.style.animationDirection = "reverse";
  }
}

function displayTopGradient(value) {
  const shouldDisplay = !!value;

  if (shouldDisplay) {
    // attach a new class to the div that will slide it in to view
    slideBox.classList.add("visible");
  }
  if (!shouldDisplay) {
    // Remove said class to let it slide out of view
    slideBox.classList.remove("visible");
  } else return;
}
