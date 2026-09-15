const body = {
  mediaRecordId: "recAII3fGeek7ShHa",
  mediaType: "image",
  objectKey: "social-hub/x/Austen/1935730260303069184/1.jpg",
  force: true,
};

const res = await fetch("http://127.0.0.1:8787/demo/save-media", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
console.log(res.status, await res.text());
