Write-Host "Starting Jekyll local development server via Docker..." -ForegroundColor Cyan

# Remove any existing container quietly to start fresh
docker rm -f jekyll-server 2>$null

# Run the jekyll container with an inline webrick install so it doesn't crash on standard Ruby versions
docker run -it --rm --name jekyll-server -p 4000:4000 -v "${PWD}:/srv/jekyll" jekyll/jekyll /bin/sh -c "gem install webrick && jekyll serve --watch --force_polling --host 0.0.0.0"
