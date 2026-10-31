from flask import Flask, request, jsonify, send_from_directory
import model  # our AI file: model.py

# serve everything in the "public" folder
app = Flask(__name__, static_folder="public", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB limit


@app.route("/")
def home():
    return send_from_directory("public", "index.html")


@app.route("/predict", methods=["POST"])
def predict():
    if "image" not in request.files:
        return jsonify(error="No image uploaded"), 400

    try:
        result = model.analyze(request.files["image"].read())
    except ValueError as e:
        return jsonify(error=str(e)), 400

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=False)