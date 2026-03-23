import requests
import re
import json


def get_cps_school():
    
    base_url = "https://api.cps.edu/schoolprofile/CPS/TypeaheadSchoolSearch"
    response = requests.get(base_url)
    response.raise_for_status()

    cps_list = response.json()

    temp_list = {}

    for school in cps_list:
        if school["IsHighSchool"] == True:
            temp_list[school["SchoolLongName"]] = {"name": school["SchoolLongName"], "SchoolID":school["SchoolID"]}

    final_json = {}

    for school in  temp_list.values():
        single_url = "https://api.cps.edu/schoolprofile/CPS/SingleSchoolProfile"
        params = {"SchoolID": school['SchoolID']}
        single_response = requests.get(single_url, params=params)
        single_response.raise_for_status()

        school_profile = single_response.json()  

        final_json[school_profile['SchoolLongName']] = {"name": school_profile['SchoolLongName'],"website": school_profile['WebsiteURL'], "phone": school_profile['Phone'],  
            "contacts": {
                "administrator": {"title": school_profile.get('AdministratorTitle'), "name": school_profile.get('AdministratorFullName')},
                "second": {"title": school_profile.get('SecondContactTitle'), "name": school_profile.get('SecondContactFullName')},
                "third": {"title": school_profile.get('ThirdContactTitle'), "name": school_profile.get('ThirdContactFullName')},
                "fourth": {"title": school_profile.get('FourthContactTitle'), "name": school_profile.get('FourthContactFullName')},
                "fifth": {"title": school_profile.get('FifthContactTitle'), "name": school_profile.get('FifthContactFullName')},
                "sixth": {"title": school_profile.get('SixthContactTitle'), "name": school_profile.get('SixthContactFullName')},
                "seventh": {"title": school_profile.get('SeventhContactTitle'), "name": school_profile.get('SeventhContactFullName')}
            }
        }

        with open('cps_schools.json', 'w') as f:
            json.dump(final_json, f, indent=4)
        


if __name__ == "__main__":
    get_cps_school()