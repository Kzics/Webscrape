const axios = require('axios');
const cheerio = require('cheerio');
const https = require("https");
const url = require("url");
const fs = require("fs");


const baseUrl = 'https://edition-limitee.fr/index.php/';
const siteUrl = 'https://edition-limitee.fr/index.php/cd-audio-vinyle-edition-collector-limitee';


let dictLinks = {}
let lastProducts = {}


const retrieveLink = ()=>{
    const configData = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

    return configData.link
}


function getExtraKeys(dict1, dict2) {
    let extraKeys = [];


    for (let key in dict1) {
        if (!(key in dict2)) {
            extraKeys.push(key);
        }
    }
    return extraKeys;
}

const getLinks = async () => {
    const { data } = await axios.get(siteUrl);
    const $ = cheerio.load(data);

    // Recherche des balises 'a'
    const links = $('a');
    let count = 0

    // Récupération des href des balises 'a'
    for(let i = 0; i < links.length; i++){

        const link = links[i]
        const href = $(link).attr('href');
        let fullUrl = ""
        // Ajout de l'href à l'URL de base
        if (href) {
            if (href.startsWith("/index") && !href.includes("-page-") && href.includes("cd") && href !== "/index.php/cd-audio-vinyle-edition-collector-limitee" && count <11) {
                fullUrl = baseUrl + href;
                count++
            }
        }
        if(fullUrl) {
            const {data} = await axios.get(fullUrl);
            const $$ = cheerio.load(data);
            const subLinks = $$('a');
            const lastName = $$('i')
            const temp = []

            if(lastName.text() === "") continue;


            subLinks.each((i, subLink) => {
                const subHref = $$(subLink).attr('href');

                if(!subHref) return;

                if(subHref.includes("amzn") || subHref.includes("bit.ly")) {
                    temp.push(subHref)
                }

            });
            dictLinks[lastName.text()] = temp
        }
    }
};


async function getFinalUrl(shortUrl) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(shortUrl);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            method: 'HEAD',
            followAllRedirects: true
        };

        const req = https.request(options, (res) => {
            resolve(res.headers.location);
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}
const webhookUrl = retrieveLink();

const getAmazonLink = (dict)=>{
    let result = []
    for (const [key, value] of Object.entries(dict)) {
        if (value.toLowerCase().includes('amazon')) {
            result.push(value);
        }
    }
    return result
}
const checkForNewProduct = async (link) => {
    let defaultVal = Object.entries(link)[0][1].toString()
    let html;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0'
    };

    try {
        const response = await axios.get(defaultVal,{headers});
        html = response.data;
    } catch (error) {
        if (error.code === 'ERR_FR_TOO_MANY_REDIRECTS') {
            console.log('Too many redirects, cancelling request');
            const response = await axios.get(getAmazonLink(link)[0],{headers})
            html = response.data
        }
    }


    // Utilisez une bibliothèque de parsing HTML pour récupérer le prix à partir du code HTML
    const $ = cheerio.load(html)

    //console.log($('.reinventPricePriceToPayMargin > span:nth-child(2) > span:nth-child(1)'))
    let productName;
    let productImageURL;
    let productPrice;
    let productReleaseDate;


    let amz = ''
    let fnac = ''
    let amzCount = 1
    let fnacCount = 1

    for (const val of Object.values(link)) {
        if(val.includes('amazon')){
            amz += `\n\n[Lien${amzCount}](${val})`
            amzCount++

            if(!productName) {
                productName = $('#productTitle').text()
            }

            if(!productImageURL){
                productImageURL = $('#landingImage').attr('src')
            }

            if(!productPrice){
                productPrice = $('.reinventPricePriceToPayMargin > span:nth-child(2)').text()
                if(!productPrice && getAmazonLink(link).length > 1){
                    const response = await axios.get(getAmazonLink(link)[1],{headers})
                    productPrice = cheerio.load(response.data)('.reinventPricePriceToPayMargin > span:nth-child(2)').text()

                }
            }
            //console.log("name->" +productName)
        }else{
            fnac += `\n\n[Lien${fnacCount}](${val})`
            fnacCount++

            if(!productName) {
                productName = $('.f-faPriceBox__price').text()
            }
            if(!productReleaseDate){
                productReleaseDate = $('.a-color-success').text()
            }

        }
    }


    const embed = {
        "title": productName,
        "description": `Concernant ${productName}, ${productReleaseDate}`,
        "color": 3447003,
        "fields": [{
            "name": "Lien Amazon",
            "value": amz,
            "inline": true

        }, {
            "name": "Lien Fnac",
            "value": fnac,
            "inline": true

        },
            {
                "name": "Prix",
                "value": productPrice,
                "inline": true
            }],
        "image": {
            "url": productImageURL
        },
        "timestamp": new Date().toISOString()
    };

    const data = {
        "embeds": [embed]
    };


    axios.post(webhookUrl, data, { headers })
        .then(response => {
            //console.log(response.data);
        })
        .catch(error => {
            //console.log(error);
        });
};


async function sleep(ms){
    return new Promise((resolve)=>setTimeout(resolve,ms))
}



//appel de la fonction getLinks
async function monitor() {
    await getLinks();

    if(Object.entries(lastProducts).length === 0){
        lastProducts = dictLinks
    }

    if (lastProducts !== dictLinks) {
        const extra = getExtraKeys(lastProducts,dictLinks)
        console.log(extra)

// Itération sur les clés du dictionnaire pour obtenir les liens finaux
        for (const key of extra) {
            const links = lastProducts[key];
            const newLinks = [];
            for (let i = 0; i < links.length; i++) {
                const finalUrl = await getFinalUrl(links[i]);
                newLinks.push(finalUrl);
            }
            dictLinks[key] = newLinks;
            await sleep(500)
            await checkForNewProduct(dictLinks[key])

        }

    }

    await sleep(600000)
    await monitor()
}

monitor()